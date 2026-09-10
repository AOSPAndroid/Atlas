"""Optional local inference through stdin/stdout. No model server or network IO.

The worker is short-lived, low priority and owns all model memory. Merely
opening the palette checks small metadata files; it never starts this worker.
"""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

from fastapi import HTTPException

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / 'assistant' / 'model-manifest.json'
MODEL_DIR = ROOT / 'models' / 'atlas-qwen3-4b'
SLOT = threading.Lock()
TIMEOUT = 120


def python_path():
    return ROOT / '.venv-assistant' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')


def status():
    result = {'available': False, 'model': 'Qwen3 4B · CPU int4 KLD',
              'setup': 'Run Install_Atlas_Assistant.bat once, then reopen Ask Atlas.',
              'reason': 'The optional offline assistant is not installed.'}
    try:
        raw = MANIFEST.read_bytes()
        manifest = json.loads(raw)
        marker = json.loads((MODEL_DIR / '.verified.json').read_text(encoding='utf-8'))
        if not isinstance(manifest, dict) or not isinstance(marker, dict):
            return result
        if marker.get('manifest_sha256') != hashlib.sha256(raw).hexdigest():
            result['reason'] = 'Model version changed. Run the assistant setup again.'
            return result
        if not python_path().is_file():
            result['reason'] = 'The assistant Python environment is missing.'
            return result
        for entry in manifest['files']:
            path = MODEL_DIR / entry['path']
            recorded = marker.get('files', {}).get(entry['path'], {})
            stats = path.stat()
            if stats.st_size != entry['size'] or stats.st_mtime_ns != recorded.get('mtime_ns'):
                result['reason'] = 'Model files changed or are incomplete. Run the assistant setup again.'
                return result
        result.update(available=True, reason='', model=manifest['name'])
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        pass
    return result


async def generate(messages, request):
    ready = status()
    if not ready['available']:
        raise HTTPException(503, ready['reason'] + ' ' + ready['setup'])
    if not SLOT.acquire(blocking=False):
        raise HTTPException(429, 'Atlas is already answering a question. Wait for it to finish.')
    process = None
    pending = None
    try:
        environment = dict(os.environ, PYTHONUTF8='1', HF_HUB_OFFLINE='1',
                           TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1',
                           OMP_NUM_THREADS='4', MKL_NUM_THREADS='4')
        flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0) | getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0)
        process = subprocess.Popen(
            [str(python_path()), '-I', '-X', 'utf8', str(ROOT / 'assistant' / 'worker.py'), str(MODEL_DIR)],
            cwd=ROOT, env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace', creationflags=flags)
        pending = asyncio.create_task(asyncio.to_thread(process.communicate, json.dumps({'messages': messages}, ensure_ascii=False)))
        deadline = time.monotonic() + TIMEOUT
        while not pending.done():
            if await request.is_disconnected():
                raise HTTPException(499, 'Assistant request cancelled.')
            if time.monotonic() >= deadline:
                raise HTTPException(504, 'The local assistant timed out. Try a shorter question or less context.')
            await asyncio.wait({pending}, timeout=.2)
        stdout, _stderr = await pending
        try:
            result = json.loads(stdout)
        except (TypeError, ValueError):
            raise HTTPException(503, 'The local model could not run. Re-run Install_Atlas_Assistant.bat and try again.') from None
        if not isinstance(result, dict):
            raise HTTPException(503, 'The local model returned an invalid response. Try again.')
        if process.returncode or 'error' in result:
            detail = result.get('error', 'The local model could not complete the answer.')
            if not isinstance(detail, str):
                detail = 'The local model could not complete the answer.'
            raise HTTPException(422 if result.get('kind') == 'context' else 503, detail)
        answer = result.get('answer')
        if not isinstance(answer, str) or not answer.strip():
            raise HTTPException(503, 'The model returned no answer. Try a shorter question.')
        return answer.strip()[:20000]
    except (OSError, ValueError, TypeError):
        raise HTTPException(503, 'The local assistant process failed. Re-run the optional assistant setup and try again.') from None
    finally:
        try:
            if process is not None and process.poll() is None:
                try:
                    process.terminate()
                except OSError:
                    process.kill()
            if pending is not None:
                try:
                    await asyncio.wait_for(asyncio.shield(pending), timeout=5)
                except (OSError, ValueError, asyncio.TimeoutError, asyncio.CancelledError):
                    pass
        finally:
            try:
                if process is not None and process.poll() is None:
                    try:
                        process.kill()
                        await asyncio.to_thread(process.wait, 5)
                    except (OSError, subprocess.TimeoutExpired):
                        pass
            finally:
                SLOT.release()
