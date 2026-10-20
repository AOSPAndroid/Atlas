"""Live floor plan: keep official seating in step with the assistants' Excel plan.

Atlas watches one folder (for example the OneDrive-synced "02_Current_plan"). When the newest
desk-plan workbook there changes, it is read (seating_grid), compared with the map
(seating_excel.plan_sheet) and, when the result is clean and of a normal size, applied with a
backup. Large or unclear changes wait for review in Manage Database. Desks the plan does not
mention are left alone. Admin only: the Demo just sees the updated database.
"""
import json
import os
import shutil
import sqlite3
import tempfile
import threading
import time
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

import atlas_store as store
from atlas_store import ClosingConnection
from identity_links import key
from seating_excel import apply_sheet, layout_records, plan_sheet
from seating_grid import read_plan

SOURCE = 'Live floor plan'
STABLE_SECONDS = 30
KEEP_BACKUPS = 10
MIN_DESKS = 10


def large(changes, desks):
    """More than this many changes in one save is held for review (a reorganisation or a broken sheet)."""
    return changes > max(40, round(desks * .15))


def seating_version(con):
    """Cheap change marker for maps that refresh themselves; also names the latest sync."""
    seq = con.execute('select coalesce(max(seq),0) from history').fetchone()[0] if table(con, 'history') else 0
    links = con.execute('select count(*) from desk_link_history').fetchone()[0] if table(con, 'desk_link_history') else 0
    latest = None
    if table(con, 'seating_import_history'):
        row = con.execute("select at,source from seating_import_history where source like ? order by at desc limit 1", (SOURCE + '%',)).fetchone()
        if row:
            latest = {'at': row[0], 'source': row[1][len(SOURCE) + 3:] or row[1]}
    return {'version': f'{seq}.{links}', 'live_plan': latest}


def table(con, name):
    return con.execute("select 1 from sqlite_master where name=?", (name,)).fetchone() is not None


class Settings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    folder: str = Field(default='', max_length=1024)
    enabled: bool = False


class SeatingSync:
    def __init__(self, db, state_path, backups, busy=lambda: False, interval=60, clock=time.time):
        # db/backups may be callables, so the sync follows the server's current database path.
        self._db, self._backups, self.state_path = db, backups, Path(state_path)
        self.busy, self.interval, self.clock = busy, interval, clock
        self.lock = threading.Lock()
        self.held = None
        self.plans = {}
        self.thread = None
        self.checked = None
        self.stop_event = threading.Event()
        self.state = self.load()
        self.state.setdefault('status', {'state': 'off', 'message': 'Choose the folder with the desk plan, then turn the live link on.'})

    @property
    def db(self):
        return Path(self._db() if callable(self._db) else self._db)

    @property
    def backups(self):
        return Path(self._backups() if callable(self._backups) else self._backups)

    # Settings and state survive restarts; held plans do not (they are rebuilt on the next check).
    def load(self):
        try:
            data = json.loads(self.state_path.read_text(encoding='utf-8'))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def save(self):
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.state_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(self.state, indent=2, ensure_ascii=False), encoding='utf-8')
        os.replace(temporary, self.state_path)

    def set_status(self, state, message, **extra):
        self.state['status'] = {'state': state, 'message': message, 'at': now(), **extra}
        self.save()

    def configure(self, settings):
        folder = settings.folder.strip().strip('"').strip()
        with self.lock:
            self.state.update(folder=folder, enabled=settings.enabled and bool(folder))
            self.state.pop('last', None)
            self.held = None
            if not self.state['enabled']:
                self.set_status('off', 'Live link is off.' if folder else 'Choose the folder with the desk plan, then turn the live link on.')
            else:
                self.set_status('checking', 'Checking the folder…')
        return self.summary()

    def summary(self):
        status = dict(self.state.get('status', {}))
        held = self.held and {'reason': self.held['reason'], 'file': self.held['file'], 'report': self.held['report'], 'reader': self.held['reader']}
        return {'folder': self.state.get('folder', ''), 'enabled': bool(self.state.get('enabled')), 'status': status,
                'checked': self.checked, 'last': self.state.get('last'), 'history': self.state.get('history', [])[:15], 'held': held}

    def candidates(self, folder):
        files = [p for p in folder.iterdir() if p.suffix.lower() == '.xlsx' and not p.name.startswith(('~$', '.'))]
        return sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)[:10]

    def check(self, force=False):
        """One pass: find the plan, and apply or hold its changes. Safe to call at any time."""
        if not self.lock.acquire(blocking=False):
            return self.summary()
        try:
            return self._check(force)
        finally:
            self.lock.release()

    def _check(self, force):
        self.checked = now()
        if not self.state.get('enabled') or not self.state.get('folder'):
            return self.summary()
        folder = Path(self.state['folder']).expanduser()
        if not folder.is_dir():
            self.set_status('error', f'Folder not reachable: {folder}. Check that OneDrive is running and the folder is synced to this PC.')
            return self.summary()
        with tempfile.TemporaryDirectory(prefix='atlas_plan_') as work:
            for path in self.candidates(folder):
                stat = path.stat()
                signature = [path.name, stat.st_mtime_ns, stat.st_size]
                if not force and self.plans.get(tuple(signature)) is False:
                    continue
                if self.clock() - stat.st_mtime < STABLE_SECONDS:
                    self.set_status('waiting', f'{path.name} was just saved; reading it in a moment.')
                    return self.summary()
                last = self.state.get('last') or {}
                if not force and last.get('signature') == signature:
                    return self.summary()
                copy = Path(work) / path.name
                try:
                    shutil.copy2(path, copy)
                    with sqlite3.connect(self.db, factory=ClosingConnection) as c:
                        c.execute('begin')
                        records, _ = layout_records(c, 'official')
                        reader = read_plan(copy, c, records)
                except (OSError, zipfile.BadZipFile) as error:
                    self.set_status('waiting', f'{path.name} could not be opened yet ({error.__class__.__name__}); retrying.')
                    return self.summary()
                except (ValueError, KeyError, IndexError, ET.ParseError):
                    self.plans[tuple(signature)] = False
                    continue
                if len(reader['rows']) < MIN_DESKS:
                    self.plans[tuple(signature)] = False
                    continue
                return self.consider(path, signature, reader)
        self.set_status('error', 'No desk plan found in this folder: no recent .xlsx contains desk codes like 02R015079.')
        return self.summary()

    def consider(self, path, signature, reader):
        modified = datetime.fromtimestamp(signature[1] / 1e9, timezone.utc).isoformat()
        with sqlite3.connect(self.db, factory=ClosingConnection) as c:
            c.execute('begin')
            records, _ = layout_records(c, 'official')
            labels = {key(row['name']) for row in reader['rows'] if row['kind'] == 'label'}
            labels |= {key(record['name']) for record in records.values() if record.get('occupancy') == 'unconfirmed'}
            rows = [{k: v for k, v in row.items() if k in ('desk', 'name', 'status', 'account', 'team', '_row')} for row in reader['rows']]
            plan = plan_sheet(c, rows, 'official', False, frozenset(labels))
        report = plan['report']
        info = {'file': path.name, 'modified': modified, 'signature': signature, 'desks': len(rows),
                'reader': {k: reader[k] for k in ('fixes', 'not_in_directory', 'unknown_desks', 'conflicts', 'sheets')}}
        counts = tally(report['changes'])
        reason = ('The plan has problems Atlas cannot resolve on its own.' if report['errors'] else
                  'The same desk appears with different names in the plan.' if reader['conflicts'] else
                  f'{len(report["changes"])} changes in one save; review them before they reach the map.' if large(len(report['changes']), len(rows)) else '')
        if reason:
            self.held = {'reason': reason, 'file': path.name, 'plan': plan, 'report': report, 'reader': info['reader'], 'info': info}
            self.state['last'] = {**info, 'result': 'held', 'counts': counts}
            self.set_status('held', f'{path.name}: {reason}', counts=counts)
            return self.summary()
        if not plan['updates']:
            self.held = None
            self.state['last'] = {**info, 'result': 'unchanged', 'counts': counts}
            self.set_status('synced', f'The map matches {path.name}.')
            return self.summary()
        if self.busy():
            self.set_status('waiting', 'Deployments or queue jobs are running; seating updates once they finish.')
            return self.summary()
        return self.apply(plan, info, counts)

    def apply(self, plan, info, counts):
        try:
            backup = apply_sheet(self.db, plan, self.backups, f'{SOURCE} · {info["file"]}')
        except store.Conflict:
            self.state.pop('last', None)
            self.set_status('waiting', 'Seating changed while reading the plan; comparing again.')
            return self.summary()
        self.held = None
        entry = {'at': now(), 'file': info['file'], 'counts': counts, 'backup': backup}
        self.state['history'] = [entry, *self.state.get('history', [])][:50]
        self.state['last'] = {**info, 'result': 'applied', 'counts': counts}
        self.prune()
        self.set_status('synced', f'Updated from {info["file"]}: {describe(counts)}.', counts=counts)
        return self.summary()

    def apply_held(self):
        with self.lock:
            if not self.held:
                raise HTTPException(409, 'Nothing is waiting for review. Check the folder again.')
            if self.held['report']['errors']:
                raise HTTPException(409, 'Fix the plan problems listed below in the Excel file; Atlas picks up the corrected file.')
            if self.busy():
                raise HTTPException(409, 'Finish active jobs and queues first.')
            held = self.held
            return self.apply(held['plan'], held['info'], tally(held['report']['changes']))

    def prune(self):
        """Keep the most recent live-plan backups; older ones are removed (imports keep their own)."""
        kept = {entry.get('backup') for entry in self.state.get('history', [])[:KEEP_BACKUPS]}
        for entry in self.state.get('history', [])[KEEP_BACKUPS:]:
            name = entry.get('backup')
            if name and name not in kept:
                (self.backups / name).unlink(missing_ok=True)

    def run(self):
        while not self.stop_event.wait(self.interval):
            try:
                self.check()
            except Exception as error:  # A bad file never stops the watcher.
                self.set_status('error', f'Live floor plan check failed: {error}')

    def start(self):
        if not self.thread:
            self.thread = threading.Thread(target=self.run, name='atlas-seating-sync', daemon=True)
            self.thread.start()

    def close(self):
        self.stop_event.set()


def tally(changes):
    counts = {}
    for change in changes:
        counts[change['kind']] = counts.get(change['kind'], 0) + 1
    return counts


def describe(counts):
    words = {'moved': 'moved', 'assigned': 'assigned', 'vacated': 'freed', 'updated': 'updated'}
    return ', '.join(f'{n} {words.get(kind, kind)}' for kind, n in counts.items()) or 'no changes'


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def register(app, wmi, check_token, busy, state_path):
    sync = SeatingSync(lambda: wmi.MASTER_DB, state_path, lambda: Path(wmi.MASTER_DB).resolve().parent / 'backups', busy)

    @app.get('/api/seating-sync')
    def status():
        return sync.summary()

    @app.post('/api/seating-sync/settings')
    def settings(body: Settings, request: Request):
        check_token(request)
        sync.configure(body)
        return sync.check(force=True)

    @app.post('/api/seating-sync/check')
    def check(request: Request):
        check_token(request)
        return sync.check(force=True)

    @app.post('/api/seating-sync/apply')
    def apply(request: Request):
        check_token(request)
        return sync.apply_held()

    @app.get('/api/official/version')
    def version():
        with sqlite3.connect(Path(wmi.MASTER_DB).resolve().as_uri() + '?mode=ro', uri=True, factory=ClosingConnection) as c:
            return seating_version(c)

    @app.on_event('startup')
    def begin():
        sync.start()

    @app.on_event('shutdown')
    def end():
        sync.close()

    return sync
