"""Bulk import from notes folders into a review queue, with a fake model."""
import json
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))
from test_local_assistant import FakeModel  # noqa: E402

import assistant_files  # noqa: E402
import knowledge_import  # noqa: E402
import local_assistant  # noqa: E402

SPOOLER = '''Printer queue stuck on PRN-PAR-03, jobs stay in "deleting".
Fix: net stop spooler, clear C:\\Windows\\System32\\spool\\PRINTERS, net start spooler, then reprint.
Escalate to the print team if the printer shows offline in its web page. This happened twice in March.'''
INVOICE = 'Invoice 2024-118 for 40 toner cartridges, total 1,240 EUR, payable in 30 days. ' * 4


def article(title, text, quote, **extra):
    return {'useful': True, 'reason': '', 'title': title, 'summary': {'text': text, 'quote': quote}, 'symptoms': [], 'causes': [],
            'steps': [], 'commands': [], 'escalate': [], 'tags': [], 'categories': [], **extra}


class Import(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.notes = self.root / 'F'
        (self.notes / 'IT').mkdir(parents=True)
        (self.notes / 'IT' / 'spooler.txt').write_text(SPOOLER, encoding='utf-8')
        (self.notes / 'IT' / 'spooler copy.txt').write_text(SPOOLER.replace('\n', '\r\n') + '\n', encoding='utf-8')
        (self.notes / 'IT' / 'todo.txt').write_text('call Sam', encoding='utf-8')
        (self.notes / 'invoice.txt').write_text(INVOICE, encoding='utf-8')
        self.model = FakeModel()
        self.config = {'assistant': {'url': self.model.url, 'context': 8192, 'folders': [str(self.notes)]}}
        self.runtime = local_assistant.Runtime(self.config, self.root)
        self.db = self.root / 'knowledge.sqlite3'
        self.importer = knowledge_import.Importer(self.db, self.runtime, self.config, assistant_files.every_file)

    def tearDown(self):
        self.importer.stop()
        if self.importer._thread:
            self.importer._thread.join(10)
        self.model.close()
        self.tmp.cleanup()

    def wait(self):
        self.importer._thread.join(20)
        self.assertEqual(self.importer.state['state'], 'idle')
        return self.importer.status()

    def outcomes(self):
        with knowledge_import.closing(knowledge_import.connect(self.db)) as c:
            return {Path(r['path']).name: (r['outcome'], r['reason']) for r in c.execute('SELECT * FROM import_files')}

    def test_plan_counts_files_and_types(self):
        plan = self.importer.plan(str(self.notes))
        self.assertEqual((plan['files'], plan['new'], plan['done_before']), (4, 4, 0))
        self.assertEqual(plan['by_type'], {'.txt': 4})
        self.assertEqual(self.importer.plan(str(self.notes / 'IT'))['files'], 3, 'A folder inside the notes folder')
        self.assertEqual(self.importer.plan(str(self.notes), types=['md'])['files'], 0)
        self.assertEqual(self.importer.plan(str(self.notes), since=time.time() + 3600)['files'], 0)
        with self.assertRaises(assistant_files.FileError):
            self.importer.plan(str(self.root))

    def test_files_become_checked_drafts_or_are_skipped_with_a_reason(self):
        self.model.answers += [
            {**article('Spooler', 'Jobs stay in deleting on PRN-PAR-03.', 'jobs stay in "deleting"'),
             'steps': [{'text': 'Reinstall the driver on PRN-PAR-09.', 'quote': 'reprint'}], 'categories': ['printer']},
            {**article('', '', ''), 'useful': False, 'reason': 'An invoice, not IT knowledge.'},
        ]
        self.importer.files = lambda config, limit: sorted(assistant_files.every_file(config, limit), key=lambda f: f[0])
        status = self.importer.start(str(self.notes))
        self.assertEqual(status['total'], 4)
        status = self.wait()
        self.assertEqual((status['drafted'], status['skipped'], status['failed'], status['done']), (1, 3, 0, 4))
        outcomes = self.outcomes()
        self.assertEqual(outcomes['todo.txt'], ('skipped', 'too short to be an article'))
        self.assertEqual(outcomes['invoice.txt'], ('skipped', 'not IT knowledge: An invoice, not IT knowledge.'))
        self.assertEqual(outcomes['spooler copy.txt'], ('drafted', ''))
        self.assertEqual(outcomes['spooler.txt'], ('duplicate', 'same text as spooler copy.txt'), 'Copies are drafted once')
        self.assertEqual(len(self.model.requests), 2, 'Short files and copies never reach the model')
        self.assertIn('First decide "useful"', self.model.requests[0]['messages'][0]['content'])
        self.assertIn('Suggested title: spooler', self.model.requests[0]['messages'][1]['content'])
        self.assertEqual(status['drafts'], {'pending': 1})
        with knowledge_import.closing(knowledge_import.connect(self.db)) as c:
            draft = knowledge_import._draft(c.execute('SELECT * FROM article_drafts').fetchone())
        self.assertEqual((draft['title'], draft['flags'], draft['categories']), ('Spooler', 1, ['printer']))
        self.assertEqual(draft['review']['checks'][0]['text'], 'Reinstall the driver on PRN-PAR-09.')

    def test_imports_resume_without_drafting_twice_and_redo_changed_files(self):
        self.model.answers += [article('Spooler', 'Jobs stay in deleting.', 'jobs stay in "deleting"'),
                               {**article('', '', ''), 'useful': False, 'reason': 'invoice'}]
        self.importer.start(str(self.notes))
        self.wait()
        self.assertEqual(self.importer.plan(str(self.notes))['new'], 0)
        self.assertEqual(self.importer.start(str(self.notes))['total'], 0, 'Everything was done before')
        self.wait()
        (self.notes / 'invoice.txt').write_text(INVOICE + ' Updated.', encoding='utf-8')
        self.model.answers.append({**article('', '', ''), 'useful': False, 'reason': 'still an invoice'})
        self.assertEqual(self.importer.start(str(self.notes))['total'], 1, 'Only the changed file')
        self.wait()
        self.assertEqual(self.outcomes()['invoice.txt'], ('skipped', 'not IT knowledge: still an invoice'))

    def test_your_own_requests_go_first(self):
        self.model.answers += [article('Spooler', 'Jobs stay in deleting.', 'jobs stay in "deleting"'),
                               {**article('', '', ''), 'useful': False, 'reason': 'invoice'}]
        self.runtime.waiting = 1
        self.importer.start(str(self.notes))
        time.sleep(0.6)
        self.assertEqual(self.model.requests, [], 'The import waits while you use the Assistant')
        self.runtime.waiting = 0
        self.assertEqual(self.wait()['drafted'], 1)

    def test_pause_resume_and_stop(self):
        self.model.answers += [article('Spooler', 'Jobs stay in deleting.', 'jobs stay in "deleting"')]
        self.importer.pause()
        self.assertEqual(self.importer.state['state'], 'idle', 'Nothing to pause')
        self.runtime.waiting = 1  # hold the job before its first file
        self.importer.start(str(self.notes))
        self.importer.pause()
        self.runtime.waiting = 0
        time.sleep(0.3)
        self.assertEqual((self.importer.state['state'], self.importer.state['done']), ('paused', 0))
        self.importer.stop()
        status = self.wait()
        self.assertEqual((status['done'], status['message']), (0, 'Stopped.'))
        self.assertEqual(self.model.requests, [])

    def test_resume_after_pause(self):
        self.model.answers += [article('Spooler', 'Jobs stay in deleting.', 'jobs stay in "deleting"'),
                               {**article('', '', ''), 'useful': False, 'reason': 'invoice'}]
        self.runtime.waiting = 1
        self.importer.start(str(self.notes))
        self.importer.pause()
        self.runtime.waiting = 0
        time.sleep(0.3)
        self.assertEqual(self.importer.status()['done'], 0)
        self.assertEqual(self.importer.resume()['state'], 'running')
        status = self.wait()
        self.assertEqual((status['done'], status['drafted'], status['message']), (4, 1, 'Finished.'))

    def test_a_model_that_stops_ends_the_import_with_a_message(self):
        self.model.close()
        self.importer.start(str(self.notes / 'IT'))
        status = self.wait()
        self.assertIn('does not answer', status['message'])
        self.assertEqual(status['failed'], 1)


class Review(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.db = self.root / 'knowledge.sqlite3'
        with knowledge_import.closing(knowledge_import.connect(self.db)) as c:
            for title, flags, cut, categories in (('Clean one', 0, False, ['printer']), ('Flagged one', 2, False, []), ('Long one', 0, True, [])):
                c.execute('INSERT INTO article_drafts(path,title,markdown,tags,categories,review,flags,status,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)',
                          ('F:\\IT\\' + title + '.txt', title, '## Steps\n1. Do it.\n', json.dumps(['tag']), json.dumps(categories),
                           json.dumps({'checks': [], 'dropped': [], 'sources': [title], 'cut': cut, 'seconds': 1, 'model': 'm'}),
                           flags, 'pending', 'now', 'now'))
            c.commit()
        app = FastAPI()
        app.state.assistant = SimpleNamespace(waiting=0)
        wmi = SimpleNamespace(CONFIG={'assistant': {'folders': []}}, ROOT=self.root)

        def check_token(request):
            if request.headers.get('x-atlas-token') != 'token':
                raise HTTPException(403, 'Refresh Atlas')
        knowledge_import.register(app, wmi, check_token, lambda: self.db)
        self.client = TestClient(app)
        self.headers = {'X-Atlas-Token': 'token'}

    def tearDown(self):
        self.tmp.cleanup()

    def articles(self):
        from knowledge_articles import all_articles
        return {a['title']: a for a in all_articles(self.db)}

    def test_queue_publish_reject_and_publish_clean(self):
        listed = self.client.get('/api/knowledge/drafts').json()['drafts']
        self.assertEqual([(d['title'], d['flags']) for d in listed], [('Clean one', 0), ('Long one', 0), ('Flagged one', 2)], 'Clean drafts first')
        flagged = next(d for d in listed if d['flags'])
        self.assertEqual(self.client.post(f"/api/knowledge/drafts/{flagged['id']}/publish", json={}).status_code, 403)
        edited = self.client.post(f"/api/knowledge/drafts/{flagged['id']}/publish", headers=self.headers,
                                  json={'title': 'Fixed title', 'markdown': '## Steps\n1. Checked.\n', 'tags': ['printer'], 'categories': ['printer']})
        self.assertEqual(edited.status_code, 200, edited.text)
        saved = self.articles()['Fixed title']
        self.assertEqual((saved['id'], saved['markdown'], saved['tags'], saved['categories'], saved['revision']),
                         (edited.json()['article'], '## Steps\n1. Checked.\n', ['printer'], ['printer'], 1))
        self.assertEqual(self.client.post(f"/api/knowledge/drafts/{flagged['id']}/publish", headers=self.headers, json={}).status_code, 409)
        self.assertEqual(self.client.post(f"/api/knowledge/drafts/{flagged['id']}/publish", headers=self.headers,
                                          json={'categories': ['nonsense']}).status_code, 409)
        long_one = next(d for d in listed if d['title'] == 'Long one')
        self.assertEqual(self.client.post(f"/api/knowledge/drafts/{long_one['id']}/reject", headers=self.headers).json(), {'rejected': True})
        result = self.client.post('/api/knowledge/drafts/publish-clean', headers=self.headers).json()
        self.assertEqual(result['published'], 1)
        self.assertEqual(sorted(self.articles()), ['Clean one', 'Fixed title'])
        self.assertEqual(self.client.get('/api/knowledge/drafts').json()['drafts'], [])
        self.assertEqual([d['title'] for d in self.client.get('/api/knowledge/drafts?status=rejected').json()['drafts']], ['Long one'])
        self.assertEqual(self.client.get('/api/knowledge/drafts/999').status_code, 404)

    def test_publish_clean_leaves_shortened_drafts_for_a_person(self):
        result = self.client.post('/api/knowledge/drafts/publish-clean', headers=self.headers).json()
        self.assertEqual(result['published'], 1)
        self.assertEqual(sorted(d['title'] for d in self.client.get('/api/knowledge/drafts').json()['drafts']), ['Flagged one', 'Long one'])

    def test_invalid_edits_are_refused(self):
        draft = self.client.get('/api/knowledge/drafts').json()['drafts'][0]
        response = self.client.post(f"/api/knowledge/drafts/{draft['id']}/publish", headers=self.headers, json={'categories': ['nonsense']})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.articles(), {})

    def test_import_controls_need_the_token(self):
        for url in ('/api/knowledge/import/plan', '/api/knowledge/import/start', '/api/knowledge/import/pause', '/api/knowledge/drafts/publish-clean'):
            self.assertEqual(self.client.post(url, json={'folder': 'F:\\'}).status_code, 403, url)
        self.assertEqual(self.client.post('/api/knowledge/import/explode', headers=self.headers).status_code, 404)
        self.assertEqual(self.client.post('/api/knowledge/import/plan', headers=self.headers, json={'folder': str(self.root)}).status_code, 400)


if __name__ == '__main__':
    unittest.main()
