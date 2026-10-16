"""Local Assistant: a small language model running on this PC through llama.cpp, used only on text
Atlas gives it (notes, emails, screen text, Knowledge Base articles) and checked in code before
anything is shown. No cloud service and no Ollama: Atlas starts llama.cpp's llama-server itself
(or, without it, the llama-cpp-python library in assistant_worker.py), listening on 127.0.0.1 only,
and stops it when idle.

Admin only; never registered on the LAN viewer.
"""
import atexit
import importlib.util
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field

DEFAULTS = {'url': '', 'server': '', 'model': '', 'gpu_layers': 99, 'context': 8192, 'port': 8775, 'idle_minutes': 30, 'folders': []}
LOAD_TIMEOUT = 180


def _end_with_atlas():
    """Linux: the model server is stopped if Atlas itself dies (Windows uses a job object below)."""
    try:
        import ctypes
        import signal
        ctypes.CDLL('libc.so.6', use_errno=True).prctl(1, signal.SIGTERM)  # PR_SET_PDEATHSIG
    except (OSError, AttributeError):
        pass


def _windows_job(process):
    """Put the model server in a job that Windows closes, killing the server, when Atlas exits for any reason."""
    try:
        import ctypes
        from ctypes import wintypes

        class Basic(ctypes.Structure):
            _fields_ = [('PerProcessUserTimeLimit', ctypes.c_int64), ('PerJobUserTimeLimit', ctypes.c_int64),
                        ('LimitFlags', wintypes.DWORD), ('MinimumWorkingSetSize', ctypes.c_size_t),
                        ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', wintypes.DWORD),
                        ('Affinity', ctypes.c_size_t), ('PriorityClass', wintypes.DWORD), ('SchedulingClass', wintypes.DWORD)]

        class Counters(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in ('Read', 'Write', 'Other', 'ReadBytes', 'WriteBytes', 'OtherBytes')]

        class Extended(ctypes.Structure):
            _fields_ = [('BasicLimitInformation', Basic), ('IoInfo', Counters), ('ProcessMemoryLimit', ctypes.c_size_t),
                        ('JobMemoryLimit', ctypes.c_size_t), ('PeakProcessMemoryUsed', ctypes.c_size_t), ('PeakJobMemoryUsed', ctypes.c_size_t)]

        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.CreateJobObjectW.restype = wintypes.HANDLE
        job = kernel.CreateJobObjectW(None, None)
        info = Extended()
        info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        kernel.SetInformationJobObject(wintypes.HANDLE(job), 9, ctypes.byref(info), ctypes.sizeof(info))  # extended limits
        kernel.AssignProcessToJobObject(wintypes.HANDLE(job), wintypes.HANDLE(process._handle))
        return job  # kept open for as long as Atlas runs
    except (OSError, AttributeError, ValueError):
        return None


class AssistantError(Exception):
    def __init__(self, message, status=503):
        super().__init__(message)
        self.status = status


def find_files(root):
    """llama-server and a .gguf model dropped into Atlas\\llm (the zero-configuration setup)."""
    folder = Path(root) / 'llm'
    if not folder.is_dir():
        return '', ''
    names = ('llama-server.exe', 'llama-server') if os.name == 'nt' else ('llama-server', 'llama-server.exe')
    server = next((str(p) for name in names for p in sorted(folder.rglob(name)) if p.is_file()), '')
    models = [p for p in folder.rglob('*.gguf') if p.is_file() and not p.name.lower().startswith('mmproj')]
    model = str(max(models, key=lambda p: p.stat().st_size)) if models else ''
    return server, model


class Runtime:
    def __init__(self, config, root):
        self.config, self.root = config, Path(root)
        self.process = None
        self.mode = ''
        self.error = ''
        self.started = self.last_used = 0.0
        self.lock = threading.Lock()      # one model call at a time; small GPUs cannot run two
        self.waiting = 0                  # your own requests waiting; background imports step aside for them
        self.turn_timeout = 240           # how long your request waits for a background draft to finish
        self.state_lock = threading.Lock()
        self._watcher = None
        self.job = None

    # Settings -------------------------------------------------------------------------------
    def settings(self):
        saved = {k: v for k, v in (self.config.get('assistant') or {}).items() if v not in (None, '')}
        merged = {**DEFAULTS, **saved}
        server, model = find_files(self.root)
        merged['detected_server'], merged['detected_model'] = server, model
        merged['server'] = merged['server'] or server
        merged['model'] = merged['model'] or model
        return merged

    def url(self):
        s = self.settings()
        return (s['url'] or f"http://127.0.0.1:{int(s['port'])}").rstrip('/')

    def launch_command(self, s):
        port, layers, context = str(int(s['port'])), str(int(s['gpu_layers'])), str(int(s['context']))
        if s['server']:
            return 'llama-server', [s['server'], '-m', s['model'], '--host', '127.0.0.1', '--port', port,
                                    '-ngl', layers, '-c', context, '-np', '1', '--jinja']
        if importlib.util.find_spec('llama_cpp') is not None:
            # No llama-server.exe: the Python library (Install-Assistant.bat) in its own process.
            return 'python', [sys.executable, str(Path(__file__).with_name('assistant_worker.py')), '--model', s['model'],
                              '--port', port, '--gpu-layers', layers, '--context', context]
        return '', []

    # Health ---------------------------------------------------------------------------------
    def _get(self, path, timeout=1.5):
        with urllib.request.urlopen(urllib.request.Request(self.url() + path), timeout=timeout) as response:
            return json.loads(response.read() or b'{}')

    def ready(self):
        try:
            self._get('/v1/models')
            return True
        except (OSError, ValueError, urllib.error.URLError):
            return False

    def running(self):
        return self.process is not None and self.process.poll() is None

    def status(self):
        s = self.settings()
        external = bool(s['url'])
        ready = self.ready()
        if not ready and self.process is not None and self.process.poll() is not None:
            self.error = self.error or self._log_tail() or f'The model server stopped (exit code {self.process.returncode}).'
            self.process = None
        mode, _ = self.launch_command(s) if s['model'] else ('', [])
        return {
            'ready': ready, 'loading': self.running() and not ready, 'mode': 'external' if external else (self.mode or mode),
            'configured': external or bool(s['model'] and mode), 'url': self.url(),
            'server': s['server'], 'model': s['model'], 'model_name': Path(s['model']).name if s['model'] else '',
            'gpu_layers': s['gpu_layers'], 'context': s['context'], 'idle_minutes': s['idle_minutes'],
            'folders': [str(f) for f in s['folders']], 'external': external, 'error': self.error,
            'detected': {'server': s['detected_server'], 'model': s['detected_model']},
            'python_library': importlib.util.find_spec('llama_cpp') is not None,
            'started_by_atlas': self.running(),
        }

    def _log_path(self):
        path = self.root / 'data' / 'assistant-server.log'
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def _log_tail(self):
        try:
            lines = [l for l in self._log_path().read_text(encoding='utf-8', errors='replace').splitlines() if l.strip()]
        except OSError:
            return ''
        useful = [l for l in lines if re.search(r'error|failed|cannot|unable|out of memory', l, re.I)]
        return (useful or lines or [''])[-1][:300]

    # Start / stop ---------------------------------------------------------------------------
    def start(self):
        with self.state_lock:
            s = self.settings()
            self.error = ''
            if s['url'] or self.ready():
                return  # an external server, or one still running from an earlier Atlas session
            if self.running():
                return
            if not s['model'] or not Path(s['model']).is_file():
                raise AssistantError('No model file. Put a .gguf model in the Atlas\\llm folder or choose one in Assistant settings.', 409)
            mode, command = self.launch_command(s)
            if not command:
                raise AssistantError('No model server found. Put llama-server.exe in the Atlas\\llm folder '
                                     '(from the llama.cpp releases), or run Install-Assistant.bat to use the Python library instead.', 409)
            if mode == 'llama-server' and not Path(s['server']).is_file():
                raise AssistantError(f"llama-server was not found at {s['server']}.", 409)
            log = open(self._log_path(), 'w', encoding='utf-8', errors='replace')
            flags = 0x08000000 if os.name == 'nt' else 0  # CREATE_NO_WINDOW
            extra = {'preexec_fn': _end_with_atlas} if sys.platform.startswith('linux') else {}
            try:
                self.process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                                cwd=str(Path(command[0]).parent if mode == 'llama-server' else self.root), creationflags=flags, **extra)
            except OSError as error:
                raise AssistantError(f'Could not start the model server: {error}', 500) from error
            finally:
                log.close()
            if os.name == 'nt':
                self.job = _windows_job(self.process)
            self.mode, self.started = mode, time.time()
            self.last_used = time.time()
            self._watch()

    def wait_ready(self, timeout=LOAD_TIMEOUT):
        end = time.time() + timeout
        while time.time() < end:
            if self.ready():
                return
            if self.process is not None and self.process.poll() is not None:
                raise AssistantError('The model server stopped while loading: ' + (self._log_tail() or 'see data\\assistant-server.log'), 500)
            time.sleep(0.5)
        raise AssistantError('The model is still loading. Try again in a moment.', 503)

    def stop(self):
        with self.state_lock:
            process, self.process = self.process, None
            if process is not None and process.poll() is None:
                process.terminate()
                try:
                    process.wait(10)
                except subprocess.TimeoutExpired:
                    process.kill()

    def _watch(self):
        if self._watcher and self._watcher.is_alive():
            return

        def loop():
            while self.running():
                idle = float(self.settings().get('idle_minutes') or 0)
                if idle and not self.lock.locked() and time.time() - self.last_used > idle * 60:
                    self.stop()  # frees the graphics memory; the next request starts it again
                    break
                time.sleep(30)
        self._watcher = threading.Thread(target=loop, name='assistant-idle', daemon=True)
        self._watcher.start()

    # Model calls ----------------------------------------------------------------------------
    def _post(self, body):
        request = urllib.request.Request(self.url() + '/v1/chat/completions', data=json.dumps(body).encode(),
                                         headers={'Content-Type': 'application/json'}, method='POST')
        try:
            with urllib.request.urlopen(request, timeout=600) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            detail = error.read().decode('utf-8', 'replace')[:300]
            raise AssistantError(f'The model server refused the request ({error.code}): {detail}', 502) from error
        except (OSError, ValueError) as error:
            raise AssistantError(f'The model server did not answer: {error}', 502) from error
        finally:
            self.last_used = time.time()

    def chat(self, system, user, schema, max_tokens=1500, background=False):
        """One deterministic, schema-constrained answer as a dict.

        Your own requests wait for a background import's current file; background work never waits for them."""
        if background:
            if self.waiting or not self.lock.acquire(blocking=False):
                raise AssistantError('The Assistant is busy with your request.', 409)
        else:
            self.waiting += 1
            try:
                acquired = self.lock.acquire(timeout=self.turn_timeout)
            finally:
                self.waiting -= 1
            if not acquired:
                raise AssistantError('The Assistant is busy with another request. Try again when it finishes.', 409)
        try:
            if not self.ready():
                if self.settings()['url']:
                    raise AssistantError(f'The model server at {self.url()} does not answer. Start it, or clear "Existing model server" in Assistant settings.', 503)
                self.start()
                self.wait_ready()
            self.last_used = time.time()
            body = {'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}],
                    'temperature': 0, 'top_p': 1, 'seed': 1, 'max_tokens': max_tokens, 'stream': False,
                    # Qwen3 and similar: answer directly, without a long hidden "thinking" section.
                    'chat_template_kwargs': {'enable_thinking': False},
                    'response_format': {'type': 'json_schema', 'json_schema': {'name': 'answer', 'strict': True, 'schema': schema}}}
            started = time.time()
            for _ in range(2):  # an occasional broken answer is retried once with another seed
                data = self._post(body)
                choice = (data.get('choices') or [{}])[0]
                result = parse_json((choice.get('message') or {}).get('content') or '')
                if result is not None or choice.get('finish_reason') == 'length':
                    break
                body['seed'] = 2
            if result is None:
                raise AssistantError('The model did not return a usable answer' + (' (it ran out of room; try shorter notes)' if choice.get('finish_reason') == 'length'
                                     else '. Try again or use a larger model.'), 502)
            usage = data.get('usage') or {}
            return result, {'seconds': round(time.time() - started, 1), 'tokens': usage.get('completion_tokens'),
                            'truncated': choice.get('finish_reason') == 'length', 'model': Path(self.settings()['model']).name or data.get('model', '')}
        finally:
            self.lock.release()


def parse_json(text):
    text = re.sub(r'(?s)<think>.*?</think>', '', str(text or '')).strip()
    text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text)
    try:
        value = json.loads(text)
    except ValueError:
        start, end = text.find('{'), text.rfind('}')
        if start < 0 or end <= start:
            return None
        try:
            value = json.loads(text[start:end + 1])
        except ValueError:
            return None
    return value if isinstance(value, dict) else None


# Routes -------------------------------------------------------------------------------------
class Settings(BaseModel):
    server: str = Field('', max_length=1000)
    model: str = Field('', max_length=1000)
    url: str = Field('', max_length=300, pattern=r'^(https?://(127\.0\.0\.1|localhost)(:\d+)?/?)?$')
    gpu_layers: int = Field(99, ge=0, le=999)
    context: int = Field(8192, ge=2048, le=131072)
    idle_minutes: int = Field(30, ge=0, le=1440)
    folders: list[str] = Field(default_factory=list, max_length=20)


class Draft(BaseModel):
    notes: str = Field('', max_length=100000)
    files: list[str] = Field(default_factory=list, max_length=10)
    title: str = Field('', max_length=180)


class Reading(BaseModel):
    subject: str = Field('', max_length=1000)
    text: str = Field('', max_length=20000)


class FilePath(BaseModel):
    path: str = Field('', max_length=2000)


def register(app, wmi, check_token):
    import assistant_files
    import assistant_tasks
    runtime = Runtime(wmi.CONFIG, wmi.ROOT)
    app.state.assistant = runtime
    atexit.register(runtime.stop)

    def failure(error):
        return HTTPException(error.status, str(error))

    def index_state():
        index = getattr(wmi, 'search_index', None)
        state = dict(index.progress.get('file') or {}) if index is not None else {}
        return {k: state.get(k) for k in ('running', 'done', 'total', 'items', 'error', 'finished')}

    @app.get('/api/assistant/status')
    def status():
        return {**runtime.status(), 'index': index_state()}

    @app.post('/api/assistant/settings')
    def save(body: Settings, request: Request):
        check_token(request)
        for label, value, suffix in (('llama-server', body.server, None), ('Model', body.model, '.gguf')):
            if value and not Path(value).is_file():
                raise HTTPException(400, f'{label} file not found: {value}')
            if value and suffix and not value.lower().endswith(suffix):
                raise HTTPException(400, 'Choose a .gguf model file.')
        folders = []
        for value in body.folders:
            value = value.strip().strip('"')
            if value and not Path(value).expanduser().is_dir():
                raise HTTPException(400, f'Folder not found: {value}')
            if value and value not in folders:
                folders.append(value)
        changed = {**body.model_dump(), 'folders': folders}
        config = dict(wmi.CONFIG, assistant=changed)
        temporary = wmi.ROOT / ('config.' + uuid.uuid4().hex + '.tmp')
        try:
            temporary.write_text(json.dumps(config, indent=2), encoding='utf-8')
            os.replace(temporary, wmi.ROOT / 'config.json')
        finally:
            temporary.unlink(missing_ok=True)
        restart = runtime.running() and any((wmi.CONFIG.get('assistant') or {}).get(k) != changed[k] for k in ('server', 'model', 'gpu_layers', 'context'))
        wmi.CONFIG['assistant'] = changed
        if restart:
            runtime.stop()
        index = getattr(wmi, 'search_index', None)
        if index is not None and folders:
            index.start_background()
            index.refresh()  # index the new folders now
        return {**runtime.status(), 'index': index_state()}

    @app.post('/api/assistant/start')
    def start(request: Request):
        check_token(request)
        try:
            runtime.start()
        except AssistantError as error:
            raise failure(error) from error
        return runtime.status()

    @app.post('/api/assistant/stop')
    def stop(request: Request):
        check_token(request)
        runtime.stop()
        return runtime.status()

    @app.post('/api/assistant/files')
    def files(body: FilePath, request: Request):
        check_token(request)
        try:
            return assistant_files.listing(wmi.CONFIG, body.path)
        except assistant_files.FileError as error:
            raise HTTPException(400, str(error)) from error

    @app.post('/api/assistant/file')
    def file(body: FilePath, request: Request):
        check_token(request)
        try:
            return assistant_files.read(wmi.CONFIG, body.path)
        except assistant_files.FileError as error:
            raise HTTPException(400, str(error)) from error

    @app.post('/api/assistant/draft-article')
    def draft(body: Draft, request: Request):
        check_token(request)
        sources = []
        if body.notes.strip():
            sources.append({'name': 'Pasted notes', 'text': body.notes})
        for path in body.files:
            try:
                item = assistant_files.read(wmi.CONFIG, path)
            except assistant_files.FileError as error:
                raise HTTPException(400, str(error)) from error
            sources.append({'name': item['name'], 'text': item['text']})
        if not any(s['text'].strip() for s in sources):
            raise HTTPException(400, 'Paste some notes or choose a file first.')
        try:
            return assistant_tasks.draft_article(runtime, sources, body.title)
        except AssistantError as error:
            raise failure(error) from error

    @app.post('/api/assistant/read')
    def read(body: Reading, request: Request):
        check_token(request)
        if not body.text.strip():
            raise HTTPException(400, 'There is no text to read.')
        try:
            references = assistant_tasks.references(wmi, body.subject, body.text)
            return assistant_tasks.read_request(runtime, body.subject, body.text, references)
        except AssistantError as error:
            raise failure(error) from error
