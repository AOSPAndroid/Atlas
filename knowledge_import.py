"""Import knowledge from your notes folders (for example all of F:\\) into a review queue.

A background job goes through the files one at a time: too short, duplicate, unchanged or
not-IT-knowledge files are skipped with a reason; the rest become drafts checked line by line
(assistant_tasks.draft_article). Nothing is published until you click Publish. Progress is kept in
knowledge.sqlite3, so the job resumes after a restart without drafting a file twice.

Admin only; never registered on the LAN viewer.
"""
import hashlib
import json
import re
import sqlite3
import threading
import time
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field

MIN_CHARS = 80  # a three-line fix is still knowledge
SCHEMA = [
    '''CREATE TABLE IF NOT EXISTS import_files(path TEXT PRIMARY KEY, signature TEXT NOT NULL, digest TEXT, outcome TEXT NOT NULL,
       reason TEXT, draft INTEGER, updated TEXT NOT NULL)''',
    '''CREATE TABLE IF NOT EXISTS article_drafts(id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, title TEXT NOT NULL,
       markdown TEXT NOT NULL, tags TEXT NOT NULL, categories TEXT NOT NULL, review TEXT NOT NULL, flags INTEGER NOT NULL,
       status TEXT NOT NULL, article TEXT, created TEXT NOT NULL, updated TEXT NOT NULL)''',
]


def now():
    return datetime.now(timezone.utc).isoformat()


def connect(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(path, timeout=10)
    c.row_factory = sqlite3.Row
    for statement in SCHEMA:
        c.execute(statement)
    return c


def digest(text):
    """Same notes saved twice (copies, renamed files) give the same digest."""
    return hashlib.sha1(' '.join(re.findall(r'\w+', text.casefold())).encode()).hexdigest()


def slug(title):
    base = re.sub(r'[^a-z0-9]+', '-', title.casefold()).strip('-')[:60] or 'article'
    return f'{base}-{int(time.time() * 1000) % 10 ** 8:x}'


class Importer:
    def __init__(self, path, runtime, config, files):
        """path: knowledge.sqlite3; files: (config, limit) -> [(path, signature, mtime_ns)]."""
        self.path, self.runtime, self.config, self.files = path, runtime, config, files
        self.state = {'state': 'idle', 'folder': '', 'total': 0, 'done': 0, 'drafted': 0, 'skipped': 0, 'failed': 0,
                      'current': '', 'started': None, 'seconds_per_file': None, 'message': ''}
        self.lock = threading.Lock()
        self._resume = threading.Event()
        self._resume.set()
        self._stop = False
        self._thread = None

    # Planning --------------------------------------------------------------------------------
    def candidates(self, folder, types=(), since=0):
        import assistant_files
        root = assistant_files.resolve(self.config, folder)
        chosen = {t.lower() if t.startswith('.') else '.' + t.lower() for t in types} or assistant_files.SUPPORTED
        found = []
        for path, signature, modified in self.files(self.config, None):
            p = Path(path)
            if (p == root or root in p.parents) and p.suffix.lower() in chosen and modified / 1e9 >= since:
                found.append((path, signature))
        return found

    def plan(self, folder, types=(), since=0):
        found = self.candidates(folder, types, since)
        with closing(connect(self.path)) as c:
            known = dict(c.execute('SELECT path, signature FROM import_files').fetchall())
        new = [p for p, s in found if known.get(p) != s]
        return {'files': len(found), 'new': len(new), 'done_before': len(found) - len(new),
                'by_type': _count_types(p for p, _ in found), 'seconds_per_file': self.state['seconds_per_file']}

    # Running ---------------------------------------------------------------------------------
    def start(self, folder, types=(), since=0, limit=0):
        with self.lock:
            if self._thread and self._thread.is_alive():
                raise HTTPException(409, 'An import is already running.')
            found = self.candidates(folder, types, since)
            with closing(connect(self.path)) as c:
                known = dict(c.execute('SELECT path, signature FROM import_files').fetchall())
            queue = [(p, s) for p, s in found if known.get(p) != s]
            if limit:
                queue = queue[:limit]
            self._stop = False
            self._resume.set()
            self.state.update(state='running', folder=str(folder), total=len(queue), done=0, drafted=0, skipped=0, failed=0,
                              current='', started=time.time(), message='')
            self._thread = threading.Thread(target=self._run, args=(queue,), name='knowledge-import', daemon=True)
            self._thread.start()
        return self.status()

    def pause(self):
        if self.state['state'] == 'running':
            self._resume.clear()
            self.state['state'] = 'paused'
        return self.status()

    def resume(self):
        if self.state['state'] == 'paused':
            self.state['state'] = 'running'
            self._resume.set()
        return self.status()

    def stop(self):
        if self.state['state'] in ('running', 'paused'):
            self._stop = True
            self.state['state'] = 'stopping'
            self._resume.set()
        return self.status()

    def _run(self, queue):
        from local_assistant import AssistantError
        timings = []
        try:
            for path, signature in queue:
                while self.runtime.waiting and not self._stop:  # your own Assistant requests go first
                    time.sleep(0.2)
                self._resume.wait()
                if self._stop:
                    break
                self.state['current'] = Path(path).name
                started = time.time()
                try:
                    outcome, reason, draft = self._one(path, signature)
                except AssistantError as error:
                    if error.status == 409:  # you started a request at the same moment: try this file again
                        time.sleep(1)
                        queue.append((path, signature))
                        continue
                    outcome, reason, draft = 'failed', str(error), None
                    if error.status >= 500 and not self.runtime.ready():
                        self.state['message'] = f'Stopped: {error}'
                        self._record(path, signature, None, outcome, reason, draft)
                        self.state['failed'] += 1
                        self.state['done'] += 1
                        break
                except Exception as error:  # one unreadable file never stops the import
                    outcome, reason, draft = 'failed', str(error)[:300], None
                self._record(path, signature, self._digest, outcome, reason, draft)
                key = {'drafted': 'drafted', 'failed': 'failed'}.get(outcome, 'skipped')
                self.state[key] += 1
                self.state['done'] += 1
                if outcome == 'drafted':
                    timings.append(time.time() - started)
                    self.state['seconds_per_file'] = round(sum(timings[-20:]) / len(timings[-20:]), 1)
        finally:
            self.state.update(state='idle', current='')
            if not self.state['message']:
                self.state['message'] = 'Stopped.' if self._stop else 'Finished.'

    def _one(self, path, signature):
        import assistant_files
        import assistant_tasks
        self._digest = None
        item = assistant_files.read(self.config, path)
        text = item['text'].strip()
        if len(text) < MIN_CHARS:
            return 'skipped', 'too short to be an article', None
        self._digest = digest(text)
        with closing(connect(self.path)) as c:
            twin = c.execute("SELECT path FROM import_files WHERE digest=? AND path<>? AND outcome IN ('drafted','skipped')",
                             (self._digest, path)).fetchone()
        if twin:
            return 'duplicate', 'same text as ' + Path(twin['path']).name, None
        stem = re.sub(r'[_-]+', ' ', Path(path).stem).strip()
        draft = assistant_tasks.draft_article(self.runtime, [{'name': Path(path).name, 'text': text}], stem, triage=True, background=True)
        if not draft.get('useful'):
            return 'skipped', 'not IT knowledge: ' + draft.get('reason', ''), None
        flags = len([c for c in draft['checks'] if not c.get('minor')]) + len(draft['dropped'])
        review = {k: draft[k] for k in ('checks', 'dropped', 'sources', 'cut', 'seconds', 'model')}
        with closing(connect(self.path)) as c:
            draft_id = c.execute('INSERT INTO article_drafts(path,title,markdown,tags,categories,review,flags,status,created,updated)'
                                 ' VALUES(?,?,?,?,?,?,?,?,?,?)',
                                 (path, draft['title'], draft['markdown'], json.dumps(draft['tags']), json.dumps(draft['categories']),
                                  json.dumps(review), flags, 'pending', now(), now())).lastrowid
            c.commit()
        return 'drafted', '', draft_id

    def _record(self, path, signature, text_digest, outcome, reason, draft):
        with closing(connect(self.path)) as c:
            c.execute('INSERT OR REPLACE INTO import_files VALUES(?,?,?,?,?,?,?)', (path, signature, text_digest, outcome, reason, draft, now()))
            c.commit()

    def status(self):
        s = dict(self.state)
        remaining = s['total'] - s['done']
        s['eta_seconds'] = round(remaining * s['seconds_per_file']) if s['seconds_per_file'] and s['state'] in ('running', 'paused') else None
        with closing(connect(self.path)) as c:
            s['drafts'] = dict(c.execute('SELECT status, count(*) FROM article_drafts GROUP BY status').fetchall())
            s['files'] = dict(c.execute('SELECT outcome, count(*) FROM import_files GROUP BY outcome').fetchall())
        return s


def _count_types(paths):
    counts = {}
    for path in paths:
        suffix = Path(path).suffix.lower()
        counts[suffix] = counts.get(suffix, 0) + 1
    return dict(sorted(counts.items(), key=lambda item: -item[1]))


def _draft(row, full=True):
    data = {'id': row['id'], 'path': row['path'], 'name': Path(row['path']).name, 'title': row['title'], 'tags': json.loads(row['tags']),
            'categories': json.loads(row['categories']), 'flags': row['flags'], 'status': row['status'], 'article': row['article'],
            'created': row['created']}
    if full:
        data.update(markdown=row['markdown'], review=json.loads(row['review']))
    return data


class Plan(BaseModel):
    folder: str = Field(min_length=1, max_length=2000)
    types: list[str] = Field(default_factory=list, max_length=30)
    since: float = Field(0, ge=0)
    limit: int = Field(0, ge=0, le=100000)


class Publish(BaseModel):
    title: str | None = Field(None, max_length=180)
    markdown: str | None = Field(None, max_length=200000)
    tags: list[str] | None = None
    categories: list[str] | None = None


def register(app, wmi, check_token, knowledge_file):
    import assistant_files
    from knowledge_articles import Article, connect as articles

    def importer():
        if not hasattr(app.state, 'knowledge_import'):
            app.state.knowledge_import = Importer(knowledge_file(), app.state.assistant, wmi.CONFIG, assistant_files.every_file)
        return app.state.knowledge_import

    def guarded(action):
        try:
            return action()
        except assistant_files.FileError as error:
            raise HTTPException(400, str(error)) from error

    @app.get('/api/knowledge/import')
    def status():
        return importer().status()

    @app.post('/api/knowledge/import/plan')
    def plan(body: Plan, request: Request):
        check_token(request)
        return guarded(lambda: importer().plan(body.folder, body.types, body.since))

    @app.post('/api/knowledge/import/start')
    def start(body: Plan, request: Request):
        check_token(request)
        return guarded(lambda: importer().start(body.folder, body.types, body.since, body.limit))

    @app.post('/api/knowledge/import/{action}')
    def control(action: str, request: Request):
        check_token(request)
        actions = {'pause': importer().pause, 'resume': importer().resume, 'stop': importer().stop}
        if action not in actions:
            raise HTTPException(404, 'Unknown import action')
        return actions[action]()

    @app.get('/api/knowledge/drafts')
    def drafts(status: str = 'pending'):
        with closing(connect(knowledge_file())) as c:
            rows = c.execute('SELECT * FROM article_drafts WHERE status=? ORDER BY flags, title COLLATE NOCASE LIMIT 2000', (status,)).fetchall()
        return {'drafts': [_draft(r, full=False) for r in rows]}

    def one(c, draft_id):
        row = c.execute('SELECT * FROM article_drafts WHERE id=?', (draft_id,)).fetchone()
        if row is None:
            raise HTTPException(404, 'Draft not found')
        return row

    @app.get('/api/knowledge/drafts/{draft_id}')
    def draft(draft_id: int):
        with closing(connect(knowledge_file())) as c:
            return _draft(one(c, draft_id))

    def publish_row(c, row, edits=None):
        edits = edits or Publish()
        article = Article(title=edits.title if edits.title is not None else row['title'],
                          markdown=edits.markdown if edits.markdown is not None else row['markdown'],
                          tags=edits.tags if edits.tags is not None else json.loads(row['tags']),
                          categories=edits.categories if edits.categories is not None else json.loads(row['categories']), revision=0)
        article_id, stamp = slug(article.title), now()
        with closing(articles(knowledge_file())) as a:
            a.execute('INSERT INTO articles VALUES(?,?,?,?,?,?,?,?)', (article_id, article.title.strip(), article.markdown, json.dumps(article.tags),
                                                                       json.dumps(article.categories), 1, stamp, stamp))
            a.commit()
        c.execute("UPDATE article_drafts SET status='published', article=?, updated=? WHERE id=?", (article_id, stamp, row['id']))
        return article_id

    @app.post('/api/knowledge/drafts/{draft_id}/publish')
    def publish(draft_id: int, body: Publish, request: Request):
        check_token(request)
        with closing(connect(knowledge_file())) as c:
            row = one(c, draft_id)
            if row['status'] != 'pending':
                raise HTTPException(409, 'This draft was already ' + row['status'] + '.')
            try:
                article_id = publish_row(c, row, body)
            except ValueError as error:
                raise HTTPException(422, str(error)) from error
            c.commit()
        return {'article': article_id}

    @app.post('/api/knowledge/drafts/{draft_id}/reject')
    def reject(draft_id: int, request: Request):
        check_token(request)
        with closing(connect(knowledge_file())) as c:
            one(c, draft_id)
            c.execute("UPDATE article_drafts SET status='rejected', updated=? WHERE id=? AND status='pending'", (now(), draft_id))
            c.commit()
        return {'rejected': True}

    @app.post('/api/knowledge/drafts/publish-clean')
    def publish_clean(request: Request):
        """Publish every pending draft whose lines all passed the checks."""
        check_token(request)
        published = []
        with closing(connect(knowledge_file())) as c:
            for row in c.execute("SELECT * FROM article_drafts WHERE status='pending' AND flags=0").fetchall():
                review = json.loads(row['review'])
                if review.get('cut'):
                    continue  # shortened notes: a person checks nothing important is missing
                published.append(publish_row(c, row))
            c.commit()
        return {'published': len(published), 'articles': published}
