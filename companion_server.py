"""Atlas side of the Atlas Companion.

Atlas Admin runs elevated under a separate, otherwise empty account (x01426046_dsk), so it cannot see the
operator's Outlook, Teams or clipboard. The Companion (atlas_companion.py) runs in the operator's normal
Windows session and sends what it collects here over the loopback connection:

- every clipboard copy (text, a copied screenshot for OCR, copied file names) into the clipboard
  history, enriched by clipboard_history;
- new classic Outlook mail and Teams/Outlook notification previews into an Atlas-owned queue that
  Live Inbox reads.

Atlas can also ask the Companion to act in that session (the command channel): open an Outlook reply
window or the original email, mark an email done in Outlook, open a Teams chat or a link signed in as
the operator, show a Windows alert, or show the notification listener for its permission prompt. The
Companion fetches commands with /api/companion/poll and reports each result.

At start-up Atlas writes connection.json (address and a dedicated Companion key) to a folder the
normal account can read, %ProgramData%\\Atlas\\Companion by default. The key only opens the
/api/companion/* intake and polling routes: it cannot run remote actions, deployments or read data back.
Settings (clipboard, Outlook, Teams, desktop alerts) are changed from Atlas and returned at each check-in.
"""
import json
import os
import secrets
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

ONLINE_SECONDS = 45
BATCH = 50
DEFAULTS = {'clipboard': True, 'mail': False, 'notifications': False, 'outlook_previews': False, 'alerts': True}
COMMAND_SECONDS = 60      # A command the Companion has not fetched by then has expired.
POLL_SECONDS = 20
KEEP_COMMANDS = 100
URL_SCHEMES = ('https', 'http', 'msteams', 'mailto', 'sip', 'tel', 'callto')
ALERT_MERGE_SECONDS = 4   # Alerts raised together (a bulk deployment) become one Windows alert.


def connection_folder():
    """Readable by the normal account: %ProgramData%\\Atlas\\Companion, or ATLAS_COMPANION_DIR."""
    if os.environ.get('ATLAS_COMPANION_DIR'):
        return Path(os.environ['ATLAS_COMPANION_DIR'])
    if os.name == 'nt':
        return Path(os.environ.get('ProgramData', r'C:\ProgramData')) / 'Atlas' / 'Companion'
    from runtime_paths import clipboard_path
    return clipboard_path().parent / 'companion'


def now():
    return datetime.now(timezone.utc)


def stamp(value=None):
    return (value or now()).isoformat(timespec='seconds')


class Part(BaseModel):
    model_config = ConfigDict(extra='ignore')
    state: str = Field('off', max_length=40)
    detail: str = Field('', max_length=500)
    captured: int = Field(0, ge=0)
    last_success_at: str | None = Field(None, max_length=40)
    paused: bool = False
    teams_seen: int = Field(0, ge=0)
    outlook_seen: int = Field(0, ge=0)
    outlook_enabled: bool = False


class Hello(BaseModel):
    model_config = ConfigDict(extra='ignore')
    version: str = Field('', max_length=40)
    user: str = Field('', max_length=200)
    computer: str = Field('', max_length=100)
    clipboard: Part = Part()
    mail: Part = Part()
    notifications: Part = Part()
    capabilities: list[str] = Field(default_factory=list, max_length=40)


class ClipboardText(BaseModel):
    model_config = ConfigDict(extra='forbid')
    text: str = Field(min_length=1, max_length=20000)


class Mail(BaseModel):
    model_config = ConfigDict(extra='ignore')
    entry_id: str = Field(min_length=1, max_length=1024)
    received_at: str = Field(min_length=10, max_length=40)
    conversation_id: str = Field('', max_length=1024)
    sender_name: str = Field('', max_length=500)
    sender_address: str = Field('', max_length=500)
    subject: str = Field('', max_length=2000)
    body: str = Field('', max_length=100_000)
    body_truncated: int = Field(0, ge=0, le=1)
    # Teams and Outlook notification previews from the notification listener travel the same way.
    channel: Literal['outlook', 'teams'] = 'outlook'
    content_kind: Literal['mail', 'notification'] = 'mail'
    app_name: str = Field('', max_length=256)


class MailBatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    # An Outlook folder hash, or "notification:<Windows app id>" for previews.
    source: str = Field(min_length=8, max_length=256, pattern=r'^[A-Za-z0-9:!._-]+$')
    messages: list[Mail] = Field(max_length=BATCH)


class Settings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    clipboard: bool | None = None
    mail: bool | None = None
    notifications: bool | None = None
    outlook_previews: bool | None = None
    alerts: bool | None = None


class Poll(BaseModel):
    model_config = ConfigDict(extra='forbid')
    wait: float = Field(POLL_SECONDS, ge=0, le=25)


class Result(BaseModel):
    model_config = ConfigDict(extra='forbid')
    ok: bool
    result: dict = Field(default_factory=dict)
    error: str = Field('', max_length=1000)


class CommandRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['outlook.reply', 'outlook.open', 'outlook.done', 'open.url', 'notify', 'notifications.show']
    args: dict = Field(default_factory=dict)
    wait: float = Field(0, ge=0, le=20)


class ReplyArgs(BaseModel):
    model_config = ConfigDict(extra='forbid')
    message_id: int = Field(ge=1)
    text: str = Field('', max_length=20000)
    reply_all: bool = False


class MessageArgs(BaseModel):
    model_config = ConfigDict(extra='forbid')
    message_id: int = Field(ge=1)
    done: bool = True


class UrlArgs(BaseModel):
    model_config = ConfigDict(extra='forbid')
    url: str = Field(min_length=4, max_length=2000)


class NotifyArgs(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=63)
    text: str = Field('', max_length=255)
    path: str = Field('/installer', max_length=200, pattern=r'^/[A-Za-z0-9/_#?=&.-]*$')


class Companion:
    def __init__(self, state_path, inbox_folder, folder=connection_folder, url='http://127.0.0.1:8770'):
        self._state_path, self._inbox, self._folder, self.url = state_path, inbox_folder, folder, url
        self.lock = threading.Lock()
        self.changed = threading.Condition(self.lock)
        self.state = self.load()
        self._token = None
        self.commands = {}

    def _path(self, value):
        return Path(value() if callable(value) else value)

    @property
    def state_path(self):
        return self._path(self._state_path)

    @property
    def inbox(self):
        return self._path(self._inbox)

    @property
    def folder(self):
        return self._path(self._folder)

    def load(self):
        try:
            data = json.loads(self.state_path.read_text(encoding='utf-8'))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def save(self):
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.state_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(self.state, indent=2), encoding='utf-8')
        os.replace(temporary, self.state_path)

    def settings(self):
        return {**DEFAULTS, **self.state.get('settings', {})}

    def token(self):
        """The Companion key, created once and written with the address for the normal account."""
        path = self.folder / 'connection.json'
        try:
            saved = json.loads(path.read_text(encoding='utf-8'))
            if saved.get('url') == self.url and len(saved.get('token', '')) >= 32:
                return saved['token']
        except (OSError, ValueError):
            pass
        token = secrets.token_urlsafe(32)
        self.folder.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps({'version': 1, 'url': self.url, 'token': token}, indent=2), encoding='utf-8')
        os.replace(temporary, path)
        return token

    def check(self, request):
        if self._token is None:
            self._token = self.token()
        if not secrets.compare_digest(request.headers.get('x-atlas-companion', ''), self._token):
            raise HTTPException(403, 'Unknown Companion key. Restart the Atlas Companion so it reads the current connection.')

    def hello(self, body):
        with self.lock:
            self.state['companion'] = {**body.model_dump(), 'seen': stamp(), 'seen_epoch': time.time()}
            self.save()
            return {'settings': self.settings(), 'server_time': stamp()}

    def touch(self):
        # Polling counts as being online between check-ins; not saved to disk every time.
        info = self.state.get('companion')
        if info:
            info['seen_epoch'] = time.time()

    def seen(self):
        info = self.state.get('companion')
        return info if info else None

    def online(self):
        info = self.seen()
        return bool(info) and time.time() - float(info.get('seen_epoch', 0)) < ONLINE_SECONDS

    def can(self, kind):
        """Whether the running Companion supports a command (1.0 Companions support none)."""
        return self.online() and kind in (self.seen() or {}).get('capabilities', [])

    def status(self):
        info = self.seen() or {}
        return {'known': bool(info), 'online': self.online(), 'user': info.get('user', ''), 'computer': info.get('computer', ''),
                'version': info.get('version', ''), 'last_seen': info.get('seen'), 'clipboard': info.get('clipboard', {}),
                'mail': info.get('mail', {}), 'notifications': info.get('notifications', {}), 'settings': self.settings(),
                'capabilities': info.get('capabilities', []) if self.online() else []}

    def update(self, body):
        with self.lock:
            settings = self.settings()
            settings.update({key: value for key, value in body.model_dump().items() if value is not None})
            self.state['settings'] = settings
            self.save()
        return self.status()

    # Live Inbox reads this Atlas-owned queue while the Companion supplies Outlook or Teams.
    def inbox_active(self):
        settings = self.settings()
        return bool(self.seen()) and (settings['mail'] or settings['notifications'])

    def mail_active(self):
        return bool(self.seen()) and self.settings()['mail']

    def mail_status(self):
        info = self.seen() or {}
        mail = info.get('mail', {})
        online = self.online()
        if not self.settings()['mail']:
            return {'state': 'stopped', 'running': False, 'last_success_at': mail.get('last_success_at'), 'updated_at': info.get('seen'),
                    'detail': 'Email watcher is off.', 'config': {'mailbox': 'Atlas Companion · ' + info.get('user', '')}, 'stale': False, 'interval': 15}
        state = mail.get('state', 'starting') if online else 'stopped'
        detail = mail.get('detail', '') if online else 'The Atlas Companion is not running. Start it from your normal Windows account.'
        return {'state': state, 'running': online, 'last_success_at': mail.get('last_success_at'), 'updated_at': info.get('seen'),
                'detail': detail, 'config': {'mailbox': 'Atlas Companion · ' + info.get('user', '')}, 'stale': False, 'interval': 15}

    def notification_status(self):
        """Shaped like notification_inbox.notification_status, from what the Companion reports."""
        info = self.seen() or {}
        part, online, wanted = info.get('notifications', {}), self.online(), self.settings()['notifications']
        state = (part.get('state') or 'starting') if online and wanted else 'stopped' if wanted else 'not_started'
        detail = (part.get('detail', '') if online else 'The Atlas Companion is not running. Start it from your normal Windows account.') if wanted \
            else 'Switch on Notification watcher to collect Teams previews through the Atlas Companion.'
        return {'state': state, 'running': online and wanted and state == 'watching', 'stale': False,
                'last_success_at': part.get('last_success_at'), 'detail': detail, 'captured': part.get('captured', 0),
                'teams_seen': part.get('teams_seen', 0), 'outlook_seen': part.get('outlook_seen', 0),
                'outlook_enabled': self.settings()['outlook_previews']}

    def receive_mail(self, batch):
        from outlook_watcher import MailQueue
        queue = MailQueue(self.inbox, now())
        try:
            added = 0
            for message in batch.messages:
                data = message.model_dump()
                if data['content_kind'] == 'mail':
                    added += queue.insert(batch.source, data)
                    continue
                with queue.db:
                    cursor = queue.db.execute(
                        'INSERT OR IGNORE INTO messages(source,imported_at,entry_id,received_at,conversation_id,sender_name,sender_address,'
                        'subject,body,body_truncated,channel,content_kind,app_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                        (batch.source, stamp(), data['entry_id'], data['received_at'], data['conversation_id'], data['sender_name'],
                         data['sender_address'], data['subject'], data['body'], data['body_truncated'], data['channel'], 'notification', data['app_name']))
                    added += cursor.rowcount
            return added
        finally:
            queue.close()

    def outlook_item(self, message_id):
        """The Outlook identity of a message the Companion supplied, or None."""
        path = self.inbox / 'inbox.sqlite3'
        if not path.is_file():
            return None
        connection = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=2)
        try:
            row = connection.execute("SELECT source,entry_id FROM messages WHERE id=? AND content_kind='mail'", (message_id,)).fetchone()
        finally:
            connection.close()
        return {'source': row[0], 'entry_id': row[1]} if row else None

    # Command channel ----------------------------------------------------------------------------
    def prepare(self, kind, args):
        """Validated arguments for the Companion; message ids become Outlook identities."""
        try:
            if kind == 'outlook.reply':
                body = ReplyArgs(**args)
            elif kind in ('outlook.open', 'outlook.done'):
                body = MessageArgs(**args)
            elif kind == 'open.url':
                body = UrlArgs(**args)
                if urlsplit(body.url).scheme.lower() not in URL_SCHEMES:
                    raise HTTPException(422, 'Only web, Teams, mail and phone links can be opened.')
                return {'url': body.url}
            elif kind == 'notify':
                return NotifyArgs(**args).model_dump()
            else:
                return {}
        except (TypeError, ValueError) as error:
            raise HTTPException(422, f'Invalid {kind} request: {error}') from error
        item = self.outlook_item(body.message_id)
        if item is None:
            raise HTTPException(409, 'This message did not come through the Atlas Companion, so Outlook cannot open it from here.')
        extra = {'text': body.text, 'reply_all': body.reply_all} if kind == 'outlook.reply' else {'done': body.done} if kind == 'outlook.done' else {}
        return {**item, **extra}

    def enqueue(self, kind, args):
        with self.changed:
            self.expire()
            command = {'id': uuid.uuid4().hex, 'kind': kind, 'args': args, 'state': 'pending', 'created': time.time(),
                       'result': {}, 'error': ''}
            self.commands[command['id']] = command
            for old in sorted(self.commands.values(), key=lambda c: c['created'])[:-KEEP_COMMANDS]:
                self.commands.pop(old['id'], None)
            self.changed.notify_all()
            return command

    def expire(self):
        limit = time.time() - COMMAND_SECONDS
        for command in self.commands.values():
            if command['state'] == 'pending' and command['created'] < limit:
                command.update(state='expired', error='The Atlas Companion did not pick this up. Check that it is running.')

    def poll(self, wait):
        """Pending commands for the Companion, waiting up to `wait` seconds for one to arrive."""
        deadline = time.monotonic() + wait
        with self.changed:
            self.touch()
            while True:
                self.expire()
                pending = [c for c in self.commands.values() if c['state'] == 'pending']
                remaining = deadline - time.monotonic()
                if pending or remaining <= 0:
                    break
                self.changed.wait(remaining)
            for command in pending:
                command['state'] = 'sent'
            return [{'id': c['id'], 'kind': c['kind'], 'args': c['args']} for c in sorted(pending, key=lambda c: c['created'])]

    def complete(self, command_id, body):
        with self.changed:
            command = self.commands.get(command_id)
            if command is None:
                raise HTTPException(404, 'Unknown or expired Companion command.')
            command.update(state='done' if body.ok else 'failed', result=body.result, error=body.error, finished=time.time())
            self.changed.notify_all()
            return {'state': command['state']}

    def wait_for(self, command_id, seconds):
        deadline = time.monotonic() + seconds
        with self.changed:
            while True:
                command = self.commands[command_id]
                remaining = deadline - time.monotonic()
                if command['state'] in ('done', 'failed', 'expired') or remaining <= 0:
                    return self.public(command)
                self.changed.wait(remaining)

    def public(self, command):
        return {key: command.get(key) for key in ('id', 'kind', 'state', 'result', 'error')}

    def send(self, kind, args, wait=0):
        if not self.online():
            raise HTTPException(409, 'The Atlas Companion is not running. Start it from your normal Windows account.')
        if not self.can(kind):
            raise HTTPException(409, 'Update the Atlas Companion: this version cannot do that yet (Start-Atlas-Companion.bat restarts it).')
        command = self.enqueue(kind, self.prepare(kind, args))
        return self.wait_for(command['id'], wait) if wait else self.public(command)

    def alert(self, title, text, path='/installer'):
        """A Windows alert in the operator's session, if they want them. Alerts raised within a few
        seconds of each other are merged ("3 deployments finished"). Never raises."""
        try:
            if not self.settings()['alerts'] or not self.can('notify'):
                return None
            with self.changed:
                for command in self.commands.values():
                    if command['kind'] == 'notify' and command['state'] == 'pending' and time.time() - command['created'] < ALERT_MERGE_SECONDS:
                        merged = command['args'].setdefault('merged', [command['args']['text']])
                        merged.append(text)
                        command['args']['title'] = f'{len(merged)} Atlas updates'
                        command['args']['text'] = ' · '.join(merged)[:255]
                        return command['id']
            return self.enqueue('notify', NotifyArgs(title=title[:63], text=text[:255], path=path).model_dump())['id']
        except Exception:
            return None


class CompanionInbox:
    """Live Inbox collector controls: the Companion's Outlook and Teams watchers once a Companion has
    connected, otherwise the original normal-user collectors (InboxIntegration)."""

    def __init__(self, companion, original):
        self.companion, self.original = companion, original

    def status(self):
        if not self.companion.seen():
            return self.original.status()
        info, settings, online = self.companion.status(), self.companion.settings(), self.companion.online()
        mail, notes = info.get('mail') or {}, info.get('notifications') or {}
        running = settings['mail'] or settings['notifications']
        problem = next((part.get('detail') for part, wanted in ((mail, settings['mail']), (notes, settings['notifications']))
                        if wanted and part.get('state') in ('error', 'not_installed', 'permission_required', 'retrying') and part.get('detail')), '')
        return {'configured': True, 'companion': True, 'state': 'running' if online and running else 'stopped',
                'agent_running': online, 'pending': running and not online, 'mail_user': info['user'],
                'atlas_user': '\\'.join(filter(None, (os.getenv('USERDOMAIN'), os.getenv('USERNAME')))),
                'desired': {'running': running, 'outlook': settings['mail'], 'notifications': settings['notifications'],
                            'outlook_previews': settings['outlook_previews']},
                'detail': problem if online else 'Start the Atlas Companion from your normal Windows account.',
                'directory': str(self.companion.inbox), 'errors': {}}

    def configure(self, mail_user, python=None):
        return self.original.configure(mail_user, python)

    def command(self, action, **preferences):
        if not self.companion.seen():
            return self.original.command(action, **preferences)
        from inbox_control import IntegrationError
        changes = {}
        if action == 'stop':
            changes = {'mail': False, 'notifications': False}
        elif action == 'start':
            settings = self.companion.settings()
            changes = {'mail': True} if not (settings['mail'] or settings['notifications']) else {}
        elif action == 'show':
            # The listener window, for Windows' notification permission prompt.
            try:
                self.companion.send('notifications.show', {})
            except HTTPException as error:
                raise IntegrationError(error.detail) from error
            changes = {'notifications': True}
        elif action not in ('source', 'preferences'):
            raise IntegrationError('Unsupported inbox action.')
        for key, value in preferences.items():
            if key == 'outlook':
                changes['mail'] = bool(value)
            elif key in ('notifications', 'outlook_previews'):
                changes[key] = bool(value)
        if changes:
            self.companion.update(Settings(**changes))
        return self.status()


companion = None


def register(app, wmi, check_token, state_path, inbox_folder, folder=connection_folder, url=None):
    global companion
    port = os.environ.get('ATLAS_ADMIN_PORT', '8770')
    companion = Companion(state_path, inbox_folder, folder, url or f'http://127.0.0.1:{port}')
    try:
        companion._token = companion.token()
    except OSError:
        pass  # Reported when the Companion connects; Atlas itself keeps working.

    @app.post('/api/companion/hello')
    def hello(body: Hello, request: Request):
        companion.check(request)
        return companion.hello(body)

    @app.post('/api/companion/clipboard')
    def clipboard(body: ClipboardText, request: Request):
        companion.check(request)
        if not companion.settings()['clipboard']:
            raise HTTPException(409, 'Clipboard capture is off in Atlas.')
        from clipboard_history import record
        item = record(body.text, 'companion')
        return {'id': item and item['id']}

    @app.post('/api/companion/image')
    async def image(request: Request):
        companion.check(request)
        if not companion.settings()['clipboard']:
            raise HTTPException(409, 'Clipboard capture is off in Atlas.')
        from screen_reader import IMAGE_LIMIT, ocr_image
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > IMAGE_LIMIT:
                raise HTTPException(413, 'The image is larger than 15 MB.')
        captured = ocr_image(wmi.ps, bytes(data))
        from clipboard_history import record
        item = record(captured['text'], 'screenshot')
        return {'id': item and item['id']}

    @app.post('/api/companion/mail')
    def mail(body: MailBatch, request: Request):
        companion.check(request)
        settings = companion.settings()
        kinds = {message.content_kind for message in body.messages}
        if 'mail' in kinds and not settings['mail']:
            raise HTTPException(409, 'The Outlook watcher is off in Atlas.')
        if 'notification' in kinds and not settings['notifications']:
            raise HTTPException(409, 'The notification watcher is off in Atlas.')
        try:
            return {'added': companion.receive_mail(body)}
        except (sqlite3.Error, OSError) as error:
            raise HTTPException(503, f'Atlas could not save the mail: {error}') from error

    @app.post('/api/companion/poll')
    def poll(body: Poll, request: Request):
        companion.check(request)
        return {'commands': companion.poll(body.wait), 'settings': companion.settings()}

    @app.post('/api/companion/commands/{command_id}/result')
    def result(command_id: str, body: Result, request: Request):
        companion.check(request)
        return companion.complete(command_id, body)

    @app.get('/api/companion')
    def status():
        return companion.status()

    @app.post('/api/companion/settings')
    def settings(body: Settings, request: Request):
        check_token(request)
        return companion.update(body)

    @app.post('/api/companion/commands')
    def command(body: CommandRequest, request: Request):
        check_token(request)
        return companion.send(body.kind, body.args, body.wait)

    @app.get('/api/companion/commands/{command_id}')
    def command_status(command_id: str):
        with companion.lock:
            if command_id not in companion.commands:
                raise HTTPException(404, 'Unknown or expired Companion command.')
            return companion.public(companion.commands[command_id])
    return companion
