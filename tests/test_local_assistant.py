"""Local Assistant with a fake model server: request format, answer checks, routes, start and stop."""
import json
import os
import socket
import sys
import tempfile
import textwrap
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import assistant_tasks
import local_assistant
from local_assistant import AssistantError, Runtime, find_files, parse_json

NOTES = '''printer queue stuck on PRN-PAR-03, jobs stay in "deleting"
net stop spooler
del /Q C:\\Windows\\System32\\spool\\PRINTERS\\*
net start spooler
escalate to print team if the printer shows offline'''
MESSAGE = 'VPN will not connect\nMy laptop LT-PAR-0042 cannot connect to VPN this morning. I restarted it, but the connection still times out.'
ARTICLE = {'id': 'S1', 'kind': 'article', 'ref': 'vpn', 'title': 'VPN after update',
           'text': 'VPN after update\n1. Check the user is in GRP-VPN-USERS.\n2. Reinstall GlobalProtect from Software Center, then reboot.'}


class FakeModel:
    """An OpenAI-compatible server that replays canned answers and records requests."""
    def __init__(self):
        self.answers, self.requests = [], []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reply(self, data, status=200):
                body = json.dumps(data).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                self.reply({'data': [{'id': 'fake'}]} if self.path == '/v1/models' else {}, 200 if self.path == '/v1/models' else 404)

            def do_POST(self):
                owner.requests.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                answer = owner.answers.pop(0)
                content = answer if isinstance(answer, str) else json.dumps(answer)
                self.reply({'choices': [{'message': {'content': content}, 'finish_reason': 'stop'}], 'usage': {'completion_tokens': 42}})

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.model = FakeModel()
        self.config = {'assistant': {'url': self.model.url, 'context': 8192}}
        self.runtime = Runtime(self.config, self.root)

    def tearDown(self):
        self.runtime.stop()
        self.model.close()
        self.tmp.cleanup()


class ModelCalls(Base):
    def test_requests_are_deterministic_and_bound_to_a_schema(self):
        self.model.answers.append({'ok': True})
        answer, meta = self.runtime.chat('system text', 'user text', {'type': 'object'}, max_tokens=100)
        self.assertEqual(answer, {'ok': True})
        self.assertEqual((meta['tokens'], meta['truncated']), (42, False))
        body = self.model.requests[0]
        self.assertEqual([m['role'] for m in body['messages']], ['system', 'user'])
        self.assertEqual((body['temperature'], body['max_tokens'], body['stream']), (0, 100, False))
        self.assertEqual(body['response_format'], {'type': 'json_schema', 'json_schema': {'name': 'answer', 'strict': True, 'schema': {'type': 'object'}}})
        self.assertEqual(body['chat_template_kwargs'], {'enable_thinking': False})

    def test_answers_are_parsed_carefully(self):
        self.assertEqual(parse_json('<think>hmm {"no": 1}</think>\n{"a": 1}'), {'a': 1})
        self.assertEqual(parse_json('```json\n{"a": 2}\n```'), {'a': 2})
        self.assertEqual(parse_json('Sure! Here it is: {"a": 3} Hope that helps.'), {'a': 3})
        self.assertIsNone(parse_json('[1, 2]'))
        self.assertIsNone(parse_json('no json'))
        self.model.answers.append('I cannot help with that.')
        with self.assertRaises(AssistantError) as caught:
            self.runtime.chat('s', 'u', {})
        self.assertEqual(caught.exception.status, 502)

    def test_an_existing_server_that_is_down_is_reported_at_once(self):
        self.config['assistant']['url'] = f'http://127.0.0.1:{free_port()}'
        with self.assertRaisesRegex(AssistantError, 'does not answer'):
            self.runtime.chat('s', 'u', {})

    def test_a_broken_answer_is_retried_once(self):
        self.model.answers += ['{"ok": tru', {'ok': True}]
        self.assertEqual(self.runtime.chat('s', 'u', {})[0], {'ok': True})
        self.assertEqual([r['seed'] for r in self.model.requests], [1, 2])

    def test_one_request_at_a_time(self):
        self.runtime.turn_timeout = 0.2
        self.runtime.lock.acquire()
        try:
            with self.assertRaises(AssistantError) as caught:
                self.runtime.chat('s', 'u', {})
            self.assertEqual(caught.exception.status, 409)
        finally:
            self.runtime.lock.release()
        self.assertEqual(self.model.requests, [])


class DraftArticle(Base):
    def test_draft_is_checked_against_the_notes(self):
        self.model.answers.append({
            'title': 'Printer queue stuck on PRN-PAR-03',
            'summary': {'text': 'Print jobs on PRN-PAR-03 stay in deleting.', 'quote': 'printer queue stuck on PRN-PAR-03, jobs stay in "deleting"'},
            'symptoms': [{'text': 'Jobs stay in "deleting".', 'quote': 'jobs stay in "deleting"'},
                         {'text': 'Jobs stay in "deleting".', 'quote': 'jobs stay in "deleting"'}],
            'causes': [],
            'steps': [{'text': 'Stop the spooler.', 'quote': 'net stop spooler'},
                      {'text': 'Reinstall the driver on PRN-PAR-04.', 'quote': 'reinstall the driver'}],
            'commands': [{'command': 'net stop spooler', 'purpose': 'Stop the spooler'},
                         {'command': 'del /Q C:\\Windows\\System32\\spool\\PRINTERS\\*', 'purpose': 'Clear the queue'},
                         {'command': 'Restart-Service Spooler -Force', 'purpose': 'Restart'}],
            'escalate': [{'text': 'Escalate to the print team if the printer shows offline.', 'quote': 'escalate to print team if the printer shows offline'}],
            'tags': ['printer', 'spooler', 'hardware', 'Printer'], 'categories': ['printer', 'nonsense', 'printer']})
        draft = assistant_tasks.draft_article(self.runtime, [{'name': 'spooler.txt', 'text': NOTES}], '')
        self.assertEqual(draft['title'], 'Printer queue stuck on PRN-PAR-03')
        self.assertEqual(draft['markdown'], textwrap.dedent('''\
            ## Summary
            Print jobs on PRN-PAR-03 stay in deleting.

            ## Symptoms
            - Jobs stay in "deleting".

            ## Steps
            1. Stop the spooler.
            2. Reinstall the driver on PRN-PAR-04.

            ## Escalate when
            - Escalate to the print team if the printer shows offline.

            ## Commands
            - Stop the spooler: `net stop spooler`
            - Clear the queue: `del /Q C:\\Windows\\System32\\spool\\PRINTERS\\*`

            ## Sources
            - spooler.txt
            '''))
        self.assertEqual([(c['section'], c['text']) for c in draft['checks'] if not c.get('minor')], [('Steps', 'Reinstall the driver on PRN-PAR-04.')])
        self.assertIn('not in the source: PRN-PAR-04', draft['checks'][0]['reasons'])
        self.assertEqual([d['text'] for d in draft['dropped']], ['Restart-Service Spooler -Force'], 'Invented commands never reach the article')
        self.assertEqual(draft['tags'], ['printer', 'spooler'], 'Tags must be words from the notes')
        self.assertEqual(draft['categories'], ['printer'])
        self.assertIn('NOTES:\n<<<\n### spooler.txt\nprinter queue stuck', self.model.requests[0]['messages'][1]['content'])
        schema = self.model.requests[0]['response_format']['json_schema']['schema']
        self.assertIn('printer', schema['properties']['categories']['items']['enum'])

    def test_garbled_commands_and_unrelated_issue_types(self):
        self.model.answers.append({'title': 'Spooler', 'summary': {'text': '', 'quote': ''}, 'symptoms': [], 'causes': [], 'steps': [], 'escalate': [],
                                   'commands': [{'command': 'del /Q C:\\\nWindows\\System32\\spool\\PRINTERS\\*', 'purpose': 'Clear the queue'}],
                                   'tags': [], 'categories': ['network', 'printer']})
        draft = assistant_tasks.draft_article(self.runtime, [{'name': 'spooler.txt', 'text': NOTES}])
        self.assertIn('- Clear the queue: `del /Q C:\\Windows\\System32\\spool\\PRINTERS\\*`', draft['markdown'])
        self.assertEqual(draft['checks'], [{'section': 'Commands', 'text': 'del /Q C:\\Windows\\System32\\spool\\PRINTERS\\*',
                                            'reasons': ['copied from your notes because the model changed it'], 'minor': True}])
        self.assertEqual(draft['categories'], ['printer'], 'Nothing in the notes is about the network')

    def test_issue_types_come_from_the_article_when_the_model_gives_none(self):
        self.model.answers.append({'title': 'GlobalProtect VPN after Windows update', 'summary': {'text': 'VPN will not connect after the update.', 'quote': 'VPN'},
                                   'symptoms': [{'text': 'Portal unreachable', 'quote': 'portal unreachable'}], 'causes': [],
                                   'steps': [{'text': 'Reinstall GlobalProtect.', 'quote': 'reinstall GlobalProtect'}], 'commands': [], 'escalate': [], 'tags': [], 'categories': []})
        draft = assistant_tasks.draft_article(self.runtime, [{'name': 'vpn.md', 'text': 'GlobalProtect VPN wont connect after the update, portal unreachable. Fix: reinstall GlobalProtect. Outlook was fine.'}])
        self.assertEqual(draft['categories'], ['network'], 'Outlook is only mentioned in passing, not what the article is about')

    def test_a_draft_with_nothing_to_act_on_is_flagged(self):
        self.model.answers.append({'title': 'Invoice INV-2026-0042', 'summary': {'text': 'Invoice INV-2026-0042 for 40 toner cartridges.', 'quote': 'Invoice INV-2026-0042'},
                                   'symptoms': [], 'causes': [], 'steps': [], 'commands': [], 'escalate': [], 'tags': [], 'categories': []})
        draft = assistant_tasks.draft_article(self.runtime, [{'name': 'invoice.txt', 'text': 'Invoice INV-2026-0042 for 40 toner cartridges, due in 30 days.'}])
        self.assertEqual(draft['checks'], [{'section': 'Article', 'text': 'Invoice INV-2026-0042', 'reasons': ['no steps, symptoms, cause, commands or escalation were found']}])

    def test_classify(self):
        log = '\n'.join(f'[2026-10-{d:02d} 08:00:01] job ok' for d in range(1, 20))
        self.assertEqual(assistant_tasks.classify(self.runtime, 'a.log', log), (False, 'looks like a log (mostly timestamped lines)'))
        self.assertEqual(self.model.requests, [])
        self.model.answers += [{'kind': 'known issue and workaround', 'reason': 'Teams camera fix.'}, {'kind': 'nonsense', 'reason': ''}]
        self.assertEqual(assistant_tasks.classify(self.runtime, 'cam.docx', 'Teams camera black: toggle privacy.'), (True, 'known issue and workaround: Teams camera fix.'))
        self.assertEqual(assistant_tasks.classify(self.runtime, 'x.txt', 'hello'), (False, 'other, not IT support knowledge'))
        self.assertIn('BEGINNING OF THE FILE:\n<<<\nTeams camera black', self.model.requests[0]['messages'][1]['content'])

    def test_long_notes_are_shortened_and_reported(self):
        self.model.answers.append({'title': 'x', 'summary': {'text': '', 'quote': ''}, 'symptoms': [], 'causes': [], 'steps': [],
                                   'commands': [], 'escalate': [], 'tags': [], 'categories': []})
        self.config['assistant']['context'] = 4096
        draft = assistant_tasks.draft_article(self.runtime, [{'name': 'a', 'text': 'word ' * 20000}], 'My title')
        self.assertTrue(draft['cut'])
        self.assertLess(len(self.model.requests[0]['messages'][1]['content']), 10000)
        self.assertEqual(draft['title'], 'x')
        self.assertIn('Suggested title: My title', self.model.requests[0]['messages'][1]['content'])


class ReadRequest(Base):
    def read(self, answer, sources=(ARTICLE,)):
        self.model.answers.append(answer)
        subject, text = MESSAGE.split('\n', 1)
        return assistant_tasks.read_request(self.runtime, subject, text, list(sources))

    def test_only_checked_lines_are_shown(self):
        result = self.read({
            'summary': {'text': 'The laptop cannot connect to VPN; the connection times out.', 'quote': 'cannot connect to VPN this morning'},
            'asks': [{'text': 'Help connecting to VPN', 'quote': 'cannot connect to VPN'},
                     {'text': 'Which version of Windows?', 'quote': 'VPN'}],
            'facts': [{'label': 'machine', 'value': 'LT-PAR-0042', 'quote': 'My laptop LT-PAR-0042'},
                      {'label': 'machine', 'value': 'LT-PAR-0043', 'quote': 'My laptop LT-PAR-0042'},
                      {'label': 'error', 'value': 'Error 809', 'quote': 'error 809'},
                      {'label': 'since', 'value': 'this morning', 'quote': 'this morning'}],
            'questions': ['Which version of Windows?', 'Did you restart the laptop?', 'Is LT-PAR-0099 also affected?'],
            'steps': [{'text': 'Reinstall GlobalProtect from Software Center, then reboot.', 'source': 'S1', 'quote': 'Reinstall GlobalProtect from Software Center, then reboot.'},
                      {'text': 'Reset the VPN certificate.', 'source': 'S1', 'quote': 'Reset the VPN certificate.'},
                      {'text': 'Check the firewall.', 'source': 'S7', 'quote': 'Check the firewall.'}]})
        self.assertEqual(result['summary'], 'The laptop cannot connect to VPN; the connection times out.')
        self.assertEqual([a['text'] for a in result['asks']], ['Help connecting to VPN'], 'A line also given as a question is not an ask')
        self.assertEqual([(f['label'], f['value']) for f in result['facts']], [('machine', 'LT-PAR-0042'), ('since', 'this morning')])
        self.assertEqual(result['questions'], ['Which version of Windows?'])
        self.assertEqual([(s['text'], s['source']) for s in result['steps']], [('Reinstall GlobalProtect from Software Center, then reboot.', 'S1')])
        hidden = {(h['section'], h['text']): h['reasons'] for h in result['hidden']}
        self.assertEqual(hidden[('Facts', 'machine: LT-PAR-0043')], ['not in the message: LT-PAR-0043'])
        self.assertEqual(hidden[('Facts', 'error: Error 809')], ['its quote is not in the message', 'not in the message: 809'])
        self.assertEqual(hidden[('Questions', 'Did you restart the laptop?')], ['the message probably answers it already'])
        self.assertEqual(hidden[('Questions', 'Is LT-PAR-0099 also affected?')], ['mentions details that are not in the message'])
        self.assertIn('its supporting quote is not in the source', hidden[('Steps', 'Reset the VPN certificate.')])
        self.assertEqual(hidden[('Steps', 'Check the firewall.')], ['it cites no source'])
        self.assertEqual(result['sources'], [{'id': 'S1', 'kind': 'article', 'ref': 'vpn', 'title': 'VPN after update'}])
        prompt = self.model.requests[0]['messages'][1]['content']
        self.assertIn('SOURCE S1 (Knowledge Base article: VPN after update)', prompt)
        self.assertEqual(self.model.requests[0]['response_format']['json_schema']['schema']['properties']['steps']['items']['properties']['source']['enum'], ['S1'])

    def test_a_summary_built_from_the_sources_is_hidden(self):
        result = self.read({'summary': {'text': 'Reinstall GlobalProtect from Software Center and check GRP-VPN-USERS.', 'quote': 'cannot connect to VPN'},
                            'asks': [], 'facts': [], 'questions': [], 'steps': []})
        self.assertEqual(result['summary'], '')
        self.assertEqual(result['hidden'], [{'section': 'Summary', 'text': 'Reinstall GlobalProtect from Software Center and check GRP-VPN-USERS.',
                                             'reasons': ['not in the message: GRP-VPN-USERS']}])
        result = self.read({'summary': {'text': 'Reinstall GlobalProtect from Software Center.', 'quote': ''}, 'asks': [], 'facts': [], 'questions': [], 'steps': []})
        self.assertEqual(result['hidden'][0]['reasons'], ['mostly words that are not in the message'])

    def test_a_faithful_summary_needs_no_exact_quote(self):
        result = self.read({'summary': {'text': "The laptop LT-PAR-0042 cannot connect to VPN, even after a restart.", 'quote': 'paraphrased'},
                            'asks': [], 'facts': [], 'questions': [], 'steps': []})
        self.assertEqual(result['summary'], 'The laptop LT-PAR-0042 cannot connect to VPN, even after a restart.')

    def test_without_sources_there_are_no_steps(self):
        result = self.read({'summary': {'text': 'VPN times out.', 'quote': 'the connection still times out'}, 'asks': [], 'facts': [], 'questions': []}, sources=())
        self.assertEqual(result['steps'], [])
        schema = self.model.requests[0]['response_format']['json_schema']['schema']
        self.assertNotIn('steps', schema['properties'])
        self.assertIn('SOURCES: none', self.model.requests[0]['messages'][1]['content'])

    def test_references_come_from_your_own_notes(self):
        from search_index import SearchIndex
        import assistant_files
        notes = self.root / 'notes'
        notes.mkdir()
        (notes / 'vpn.md').write_text('GlobalProtect VPN times out after update: reinstall GlobalProtect, reboot.', encoding='utf-8')
        (notes / 'printer.md').write_text('Printer queue stuck: restart spooler.', encoding='utf-8')
        config = {'assistant': {'folders': [str(notes)]}}
        index = SearchIndex(self.root / 'index.sqlite3', {'file': assistant_files.FileSource(config)})
        index.update('file')
        wmi = SimpleNamespace(CONFIG=config, search_index=index)
        found = assistant_tasks.references(wmi, 'VPN times out', 'GlobalProtect VPN times out after the update')
        self.assertEqual([(r['id'], r['kind'], r['title']) for r in found], [('S1', 'file', 'vpn.md')])
        self.assertIn('reinstall GlobalProtect', found[0]['text'])
        self.assertEqual(assistant_tasks.references(SimpleNamespace(CONFIG=config), 'x', 'y'), [])


class Routes(Base):
    def setUp(self):
        super().setUp()
        self.notes = self.root / 'notes'
        self.notes.mkdir()
        (self.notes / 'spooler.txt').write_text(NOTES, encoding='utf-8')
        (self.root / 'outside.txt').write_text('secret', encoding='utf-8')
        self.config['assistant']['folders'] = [str(self.notes)]
        self.wmi = SimpleNamespace(CONFIG=self.config, ROOT=self.root)

        def check_token(request):
            if request.headers.get('x-atlas-token') != 'token':
                raise HTTPException(403, 'Refresh Atlas')
        self.app = FastAPI()
        local_assistant.register(self.app, self.wmi, check_token)
        self.client = TestClient(self.app)
        self.headers = {'X-Atlas-Token': 'token'}

    def tearDown(self):
        self.app.state.assistant.stop()
        super().tearDown()

    def post(self, url, body=None, headers=None):
        return self.client.post(url, json=body or {}, headers=self.headers if headers is None else headers)

    def test_changes_and_file_reads_need_the_token(self):
        for url in ('/api/assistant/settings', '/api/assistant/start', '/api/assistant/stop', '/api/assistant/files',
                    '/api/assistant/file', '/api/assistant/draft-article', '/api/assistant/read'):
            self.assertEqual(self.post(url, {}, headers={}).status_code, 403, url)
        status = self.client.get('/api/assistant/status').json()
        self.assertEqual((status['ready'], status['external'], status['configured']), (True, True, True))

    def test_settings_are_validated_and_saved(self):
        model = self.root / 'model.gguf'
        model.write_bytes(b'gguf')
        self.assertEqual(self.post('/api/assistant/settings', {'model': str(self.root / 'missing.gguf')}).status_code, 400)
        self.assertEqual(self.post('/api/assistant/settings', {'model': str(self.notes / 'spooler.txt')}).status_code, 400)
        self.assertEqual(self.post('/api/assistant/settings', {'folders': [str(self.root / 'nope')]}).status_code, 400)
        self.assertEqual(self.post('/api/assistant/settings', {'url': 'https://cloud.example.com'}).status_code, 422, 'The model stays on this PC')
        saved = self.post('/api/assistant/settings', {'model': str(model), 'folders': [str(self.notes), f'"{self.notes}"'], 'gpu_layers': 20})
        self.assertEqual(saved.status_code, 200, saved.text)
        written = json.loads((self.root / 'config.json').read_text(encoding='utf-8'))['assistant']
        self.assertEqual((written['model'], written['folders'], written['gpu_layers']), (str(model), [str(self.notes)], 20))
        self.assertEqual(self.config['assistant']['gpu_layers'], 20, 'Used at once, no restart')

    def test_files_stay_inside_the_chosen_folders(self):
        listing = self.post('/api/assistant/files', {'path': str(self.notes)}).json()
        self.assertEqual([i['name'] for i in listing['items']], ['spooler.txt'])
        self.assertEqual(self.post('/api/assistant/file', {'path': str(self.notes / 'spooler.txt')}).json()['text'], NOTES)
        refused = self.post('/api/assistant/file', {'path': str(self.notes / '..' / 'outside.txt')})
        self.assertEqual(refused.status_code, 400)
        self.assertNotIn('secret', refused.text)
        self.assertEqual(self.post('/api/assistant/draft-article', {'files': [str(self.root / 'outside.txt')]}).status_code, 400)
        self.assertEqual(self.post('/api/assistant/draft-article', {'notes': '  '}).status_code, 400)
        self.assertEqual(self.post('/api/assistant/read', {'text': ''}).status_code, 400)
        self.assertEqual(self.model.requests, [], 'Nothing reached the model')

    def test_draft_and_read_endpoints(self):
        self.model.answers.append({'title': 'Spooler', 'summary': {'text': 'Jobs stay in deleting.', 'quote': 'jobs stay in "deleting"'},
                                   'symptoms': [], 'causes': [], 'steps': [], 'commands': [], 'escalate': [], 'tags': [], 'categories': []})
        draft = self.post('/api/assistant/draft-article', {'files': [str(self.notes / 'spooler.txt')], 'notes': 'extra: PRN-PAR-03 is on floor 3'}).json()
        self.assertEqual(draft['sources'], ['Pasted notes', 'spooler.txt'])
        self.assertEqual(draft['model'], '')
        self.model.answers.append({'summary': {'text': 'VPN times out.', 'quote': 'the connection still times out'}, 'asks': [], 'facts': [], 'questions': []})
        read = self.post('/api/assistant/read', {'subject': 'VPN', 'text': MESSAGE}).json()
        self.assertEqual(read['summary'], 'VPN times out.')
        self.assertEqual(read['sources'], [], 'No search index here: the message alone')

    def test_model_errors_are_explained(self):
        self.model.answers += ['not json at all', 'still not json']
        response = self.post('/api/assistant/read', {'subject': 'VPN', 'text': MESSAGE})
        self.assertEqual(response.status_code, 502)
        self.assertIn('usable answer', response.json()['detail'])


FAKE_SERVER = '''#!{python}
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
args = sys.argv[1:]
if 'fail' in open(args[args.index('-m') + 1]).read():
    print('error: failed to allocate CUDA buffer: out of memory', flush=True)
    sys.exit(1)
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        body = json.dumps({{'data': [{{'id': 'm'}}]}}).encode()
        self.send_response(200); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
print('args', ' '.join(args), flush=True)
HTTPServer(('127.0.0.1', int(args[args.index('--port') + 1])), H).serve_forever()
'''


@unittest.skipIf(os.name == 'nt', 'The fake llama-server is a script with a #! line')
class StartAndStop(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        llm = self.root / 'llm' / 'llama-b1-bin'
        llm.mkdir(parents=True)
        server = llm / 'llama-server'
        server.write_text(FAKE_SERVER.format(python=sys.executable), encoding='utf-8')
        server.chmod(0o755)
        (self.root / 'llm' / 'small.gguf').write_text('ok' * 10, encoding='utf-8')
        (self.root / 'llm' / 'mmproj-big.gguf').write_text('x' * 1000, encoding='utf-8')
        self.config = {'assistant': {'port': free_port(), 'gpu_layers': 12, 'context': 4096}}
        self.runtime = Runtime(self.config, self.root)

    def tearDown(self):
        self.runtime.stop()
        self.tmp.cleanup()

    def test_files_in_the_llm_folder_are_found(self):
        server, model = find_files(self.root)
        self.assertTrue(server.endswith('llama-server'))
        self.assertTrue(model.endswith('small.gguf'), 'Vision projector files are not models')
        self.assertEqual(find_files(self.root / 'nowhere'), ('', ''))

    def test_start_wait_and_stop(self):
        status = self.runtime.status()
        self.assertEqual((status['configured'], status['ready'], status['mode']), (True, False, 'llama-server'))
        self.runtime.start()
        self.runtime.wait_ready(20)
        status = self.runtime.status()
        self.assertEqual((status['ready'], status['started_by_atlas']), (True, True))
        log = (self.root / 'data' / 'assistant-server.log').read_text()
        self.assertIn(f"--host 127.0.0.1 --port {self.config['assistant']['port']} -ngl 12 -c 4096 -np 1", log, 'Only this PC can reach the model')
        self.runtime.start()  # already running: nothing new is started
        self.runtime.stop()
        self.assertFalse(self.runtime.status()['ready'])

    def test_a_failed_start_is_explained(self):
        (self.root / 'llm' / 'small.gguf').write_text('fail', encoding='utf-8')
        self.runtime.start()
        with self.assertRaises(AssistantError) as caught:
            self.runtime.wait_ready(20)
        self.assertIn('out of memory', str(caught.exception))

    @unittest.skipUnless(sys.platform.startswith('linux'), 'Parent-death signal is Linux; Windows uses a job object')
    def test_the_model_server_ends_when_atlas_is_killed(self):
        import signal
        import subprocess
        import time
        atlas = subprocess.Popen([sys.executable, '-c', textwrap.dedent(f'''
            import sys, time; sys.path.insert(0, {str(Path(__file__).resolve().parents[1])!r})
            from local_assistant import Runtime
            runtime = Runtime({{'assistant': {{'port': {self.config['assistant']['port']}}}}}, {str(self.root)!r})
            runtime.start(); runtime.wait_ready(20)
            print(runtime.process.pid, flush=True); time.sleep(60)''')], stdout=subprocess.PIPE, text=True)
        try:
            server = int(atlas.stdout.readline())
            atlas.send_signal(signal.SIGKILL)
            atlas.wait(10)
            for _ in range(100):
                try:
                    os.kill(server, 0)
                except ProcessLookupError:
                    break
                time.sleep(0.05)
            else:
                os.kill(server, signal.SIGKILL)
                self.fail('The model server outlived Atlas')
        finally:
            atlas.kill()

    def test_missing_files_are_explained(self):
        runtime = Runtime({'assistant': {'port': free_port()}}, self.root / 'empty')
        with self.assertRaisesRegex(AssistantError, 'No model file'):
            runtime.start()
        self.assertFalse(runtime.status()['configured'])


if __name__ == '__main__':
    unittest.main()
