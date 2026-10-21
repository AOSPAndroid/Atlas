"""Atlas Companion logic that does not touch Windows: the connection to Atlas, what to send for a
clipboard change, forwarding Outlook mail and Teams previews from the Companion's own queue, running
the commands Atlas asks for, and driving the notification listener through its command and status
files. atlas_companion.py adds the Windows parts (clipboard listener, tray icon, Outlook, the listener
app) around these classes."""
import hashlib
import html
import json
import os
import re
import sqlite3
import struct
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

VERSION = '1.1'
# What this Companion can do when Atlas asks (sent at check-in; Atlas hides what an older one cannot).
CAPABILITIES = ('outlook.reply', 'outlook.open', 'outlook.done', 'open.url', 'notify', 'notifications.show')
URL_SCHEMES = ('https', 'http', 'msteams', 'mailto', 'sip', 'tel', 'callto')
DONE_CATEGORY = 'Atlas: done'
TEXT_LIMIT = 20000
# Formats password managers and Windows set to keep a copy out of clipboard history and monitors.
PRIVATE_FORMATS = {'ExcludeClipboardContentFromMonitorProcessing', 'Clipboard Viewer Ignore'}
NO_HISTORY = 'CanIncludeInClipboardHistory'


class Offline(Exception):
    """Atlas is not reachable (not started, restarting) or refused the request."""


def connection_file():
    if os.environ.get('ATLAS_COMPANION_DIR'):
        return Path(os.environ['ATLAS_COMPANION_DIR']) / 'connection.json'
    return Path(os.environ.get('ProgramData', r'C:\ProgramData')) / 'Atlas' / 'Companion' / 'connection.json'


def read_connection(path=None):
    """(url, token) written by Atlas Admin, or Offline with what to do."""
    path = Path(path or connection_file())
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        url, token = str(data['url']).rstrip('/'), str(data['token'])
    except FileNotFoundError as error:
        raise Offline(f'Start Atlas Admin once so it writes {path}.') from error
    except PermissionError as error:
        raise Offline(f'This Windows account cannot read {path}.') from error
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise Offline(f'{path} is unreadable: {error}') from error
    if not url.startswith(('http://127.0.0.1:', 'http://localhost:')):
        raise Offline('The Companion only connects to Atlas on this PC.')
    return url, token


class Client:
    def __init__(self, url, token, opener=None, timeout=20):
        self.url, self.token, self.timeout = url, token, timeout
        self.opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def send(self, path, data, content_type, timeout=None):
        request = urllib.request.Request(self.url + path, data=data, method='POST',
                                         headers={'Content-Type': content_type, 'X-Atlas-Companion': self.token})
        try:
            with self.opener.open(request, timeout=timeout or self.timeout) as response:
                return json.loads(response.read() or b'{}')
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read()).get('detail')
            except (ValueError, AttributeError, OSError):
                detail = None
            raise Offline(f'Atlas refused {path}: {detail or error.code}') from error
        except (urllib.error.URLError, OSError, ValueError) as error:
            raise Offline(f'Atlas is not reachable at {self.url}: {error}') from error

    def post(self, path, body, timeout=None):
        return self.send(path, json.dumps(body).encode('utf-8'), 'application/json', timeout)

    def image(self, data):
        return self.send('/api/companion/image', data, 'image/bmp')


def dib_to_bmp(dib):
    """A BMP file from clipboard CF_DIB data (a BITMAPINFO header and pixels), for Atlas's OCR."""
    if len(dib) < 40:
        raise ValueError('Clipboard image is incomplete')
    header_size, = struct.unpack_from('<I', dib, 0)
    bit_count, compression = struct.unpack_from('<HI', dib, 14)
    colors_used, = struct.unpack_from('<I', dib, 32)
    masks = 12 if compression == 3 and header_size == 40 else 0  # BI_BITFIELDS colour masks follow the header.
    palette = (colors_used or (1 << bit_count if bit_count <= 8 else 0)) * 4
    offset = 14 + header_size + masks + palette
    return b'BM' + struct.pack('<IHHI', 14 + len(dib), 0, 0, offset) + dib


def private(formats, no_history=None):
    """True when the copying app asked monitors to ignore this copy (password managers do)."""
    return bool(PRIVATE_FORMATS & set(formats)) or (NO_HISTORY in formats and no_history == 0)


def signature(kind, data):
    return kind + ':' + hashlib.sha256(data if isinstance(data, bytes) else str(data).encode('utf-8')).hexdigest()


class ClipboardForwarder:
    """Sends each new copy to Atlas once; the same content copied again is skipped here."""

    def __init__(self, client):
        self.client, self.last, self.captured, self.paused, self.private = client, None, 0, False, 0
        self.state, self.detail = 'watching', ''

    def handle(self, content):
        """content: {'text': str} | {'image': bmp bytes} | {'files': [paths]} | {'private': True} | {}."""
        if self.paused or not content:
            return None
        if content.get('private'):
            self.private += 1  # A password manager or Windows asked monitors to ignore this copy.
            return None
        if 'image' in content:
            kind, data = 'image', content['image']
        else:
            text = content.get('text') or '\n'.join(content.get('files') or [])
            if not text.strip():
                return None
            kind, data = 'text', text[:TEXT_LIMIT]
        seen = signature(kind, data)
        if seen == self.last:
            return None
        try:
            result = self.client.image(data) if kind == 'image' else self.client.post('/api/companion/clipboard', {'text': data})
        except Offline as error:
            self.state, self.detail = 'error', str(error)
            raise
        self.last, self.captured = seen, self.captured + 1
        self.state, self.detail = 'watching', ''
        return result

    def report(self):
        detail = self.detail or (f'{self.private} private copies skipped (password managers)' if self.private else '')
        return {'state': 'paused' if self.paused else self.state, 'detail': detail, 'captured': self.captured, 'paused': self.paused}


class MailForwarder:
    """Forwards messages from the Companion's own queue (outlook_watcher.MailQueue, with its
    checkpoints) to Atlas, in order, remembering the last one Atlas accepted. The notification
    listener writes Teams/Outlook previews into the same queue; `kinds` says which are wanted
    (a kind that is switched off is skipped, not kept for later)."""

    FIELDS = ('entry_id', 'received_at', 'conversation_id', 'sender_name', 'sender_address', 'subject', 'body', 'body_truncated',
              'channel', 'content_kind', 'app_name')

    def __init__(self, queue, client, batch=50, kinds=('mail',)):
        self.queue, self.client, self.batch, self.kinds = queue, client, batch, tuple(kinds)

    def pending(self):
        after = self.queue.get('forwarded') or 0
        return self.queue.db.execute(
            f"SELECT id, source, {', '.join(self.FIELDS)} FROM messages WHERE id > ? ORDER BY id LIMIT ?",
            (after, self.batch)).fetchall()

    def forward(self):
        sent = 0
        while True:
            rows = self.pending()
            if not rows:
                return sent
            wanted = [row for row in rows if row['content_kind'] in self.kinds]
            for source in dict.fromkeys(row['source'] for row in wanted):
                group = [row for row in wanted if row['source'] == source]
                self.client.post('/api/companion/mail', {'source': source, 'messages': [{k: row[k] for k in self.FIELDS} for row in group]})
            with self.queue.db:
                self.queue.set('forwarded', rows[-1]['id'])
            sent += len(wanted)
            if len(rows) < self.batch:
                return sent


def hello(client, user, computer, clipboard, mail, notifications=None, capabilities=CAPABILITIES):
    """Check in with Atlas; returns its settings (clipboard, mail, notifications, outlook_previews, alerts)."""
    response = client.post('/api/companion/hello', {'version': VERSION, 'user': user, 'computer': computer,
                                                    'clipboard': clipboard, 'mail': mail, 'notifications': notifications or {},
                                                    'capabilities': list(capabilities)})
    return response.get('settings') or {}


class CommandRunner:
    """Fetches what Atlas asks for (waiting up to `wait` seconds for a request) and reports each
    result. `handlers` maps a command kind to a function of its arguments returning a dict."""

    def __init__(self, client, handlers):
        self.client, self.handlers = client, handlers

    def run_once(self, wait=20):
        response = self.client.post('/api/companion/poll', {'wait': wait}, timeout=wait + 15)
        for command in response.get('commands') or []:
            handler = self.handlers.get(command.get('kind'))
            try:
                if handler is None:
                    raise ValueError('This Companion cannot do ' + str(command.get('kind')))
                body = {'ok': True, 'result': handler(command.get('args') or {}) or {}, 'error': ''}
            except Exception as error:  # Reported to Atlas; the Companion keeps running.
                body = {'ok': False, 'result': {}, 'error': (str(error) or type(error).__name__)[:1000]}
            self.client.post(f"/api/companion/commands/{command['id']}/result", body)
        return response.get('settings')


def safe_url(url):
    """Only web, Teams, mail and phone links are opened, never files or programs."""
    url = str(url or '').strip()
    if urlsplit(url).scheme.lower() not in URL_SCHEMES:
        raise ValueError('Only web, Teams, mail and phone links can be opened.')
    return url


def reply_html(existing, text):
    """The reply text above Outlook's quoted message, in the reply's own HTML."""
    paragraphs = ''.join(f'<p>{html.escape(line) or "&nbsp;"}</p>' for line in str(text).splitlines())
    block = f'<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">{paragraphs}</div>'
    match = re.search(r'<body[^>]*>', existing or '', re.I)
    return existing[:match.end()] + block + existing[match.end():] if match else block + (existing or '')


def categories(current, separator, done, name=DONE_CATEGORY):
    """Outlook's category list with the done category added or removed. Outlook separates categories
    with the Windows list separator (";" in French settings, "," in English)."""
    names = [part.strip() for part in re.split(r'[,;]', current or '') if part.strip()]
    names = [n for n in names if n != name] + ([name] if done else [])
    return (separator.strip() + ' ').join(names)


def queue_identity(directory):
    """The Outlook profile, store and folder the Companion's queue watches (pinned at the first scan)."""
    path = Path(directory) / 'inbox.sqlite3'
    if not path.is_file():
        return None
    connection = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=2)
    try:
        row = connection.execute("SELECT value FROM watcher_state WHERE key='identity'").fetchone()
        return json.loads(row[0]) if row else None
    except sqlite3.Error:
        return None
    finally:
        connection.close()


def store_for(directory, source):
    """The Outlook store holding a forwarded email, when its source is this queue's inbox."""
    identity = queue_identity(directory)
    if identity and hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest() == source:
        return identity.get('store_id')
    return None


class ListenerMissing(Exception):
    """The notification listener app is not installed (or could not start) for this account."""


class ListenerControl:
    """Drives the Atlas Notification Listener (a Windows app; Windows only lets installed apps read
    notifications) through the files it watches in the Companion's queue folder:
    notifications-command.json (start, pause, show its window) and notifications-status.json.
    `launch` starts the app; `running` says whether it holds its queue lock."""

    RELAUNCH_SECONDS = 60

    def __init__(self, directory, launch, running, clock=time.time):
        self.directory, self.launch, self.running, self.clock = Path(directory), launch, running, clock
        self.sent, self.launched = None, 0

    def command(self, operation, previews):
        path = self.directory / 'notifications-command.json'
        expires = datetime.now(timezone.utc) + timedelta(seconds=30)
        body = {'id': uuid.uuid4().hex, 'operation': operation, 'outlook_previews': bool(previews), 'expires_at': expires.isoformat()}
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(body), encoding='utf-8')
        os.replace(temporary, path)
        self.sent = (operation.replace('_show', ''), bool(previews))

    def step(self, want, previews, show=False):
        """One check: start, pause or show the listener as Atlas's settings ask. Returns the action taken."""
        running = self.running()
        if want or show:
            if not running:
                if not show and self.clock() - self.launched < self.RELAUNCH_SECONDS:
                    return 'waiting'
                # Written first: the listener reads the command file as it starts.
                self.command('start_show' if show else 'start', previews)
                self.launched = self.clock()
                self.launch()
                return 'launched'
            if show:
                self.command('start_show', previews)
                return 'shown'
            if self.sent != ('start', bool(previews)):
                self.command('start', previews)
                return 'started'
            return 'running'
        if running and self.sent != ('pause', bool(previews)):
            self.command('pause', previews)
            return 'paused'
        return 'idle'

    def status(self, want):
        """What to report at check-in, from the listener's status file."""
        if not want:
            return {'state': 'off', 'detail': ''}
        try:
            data = json.loads((self.directory / 'notifications-status.json').read_text(encoding='utf-8-sig'))
        except (OSError, ValueError):
            data = {}
        if not self.running():
            return {'state': 'starting', 'detail': data.get('detail') or 'Starting the notification listener…',
                    'captured': data.get('captured', 0), 'last_success_at': data.get('last_success_at')}
        keep = ('state', 'detail', 'last_success_at', 'captured', 'teams_seen', 'outlook_seen', 'outlook_enabled')
        return {key: data[key] for key in keep if data.get(key) is not None} or {'state': 'starting', 'detail': ''}


def backoff(failures, low=5, high=60):
    return min(high, low * (2 ** max(0, failures - 1)))


def sleep_until(stop, seconds):
    """Wait, waking early when stop (a threading.Event) is set."""
    end = time.monotonic() + seconds
    while not stop.is_set() and time.monotonic() < end:
        stop.wait(min(0.5, end - time.monotonic()))
