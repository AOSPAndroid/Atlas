"""On-demand WMI performance samples. No remote process creation or tracing agent."""
import json
import re
import threading
from pathlib import Path

from fastapi import HTTPException

SCRIPT = Path(__file__).parent / 'scripts' / 'performance.ps1'
SLOTS = threading.BoundedSemaphore(4)
LOCK = threading.Lock()
ACTIVE = set()
# The termination endpoint independently rechecks identity and protected processes.
PROTECTED = {'system', 'idle', 'registry', 'secure system', 'smss.exe', 'csrss.exe',
             'wininit.exe', 'services.exe', 'lsass.exe', 'winlogon.exe'}


def collect(wmi, pc, kind='cpu', *, pid=None, created=None, name=None):
    pc = wmi.validate_pc(pc)
    if kind not in ('cpu', 'gpu', 'memory', 'threads'):
        raise HTTPException(400, 'Choose CPU, GPU, Memory or process threads')
    args = ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy',
            'Bypass', '-File', str(SCRIPT), '-Computer', pc, '-Kind', kind]
    if kind == 'threads':
        if (not isinstance(pid, int) or not 0 < pid <= 4294967295
                or not created or not re.fullmatch(r'\d{14}\.\d{6}[+-]\d{3}', created)
                or not name or len(name) > 260 or any(c in name for c in '\r\n\x00')):
            raise HTTPException(400, 'Refresh the process list to obtain its identity')
        args += ['-ProcessId', str(pid), '-ExpectedCreated', created, '-ExpectedName', name]
    with LOCK:
        if pc in ACTIVE or not SLOTS.acquire(blocking=False):
            raise HTTPException(429, 'A performance sample is already running or the service is busy. Try again shortly.')
        ACTIVE.add(pc)
    try:
        result = json.loads(wmi.run(args, timeout=60).stdout)
        if not isinstance(result, dict) or not result.get('ok'):
            raise ValueError(result.get('error', 'No performance result') if isinstance(result, dict) else 'Invalid performance result')
        if kind != 'threads':
            for row in result['items']:
                reason = ('Core Windows process' if row['PID'] <= 4 or row['Process'].lower() in PROTECTED
                          else '' if row.get('CreatedAt') else 'Process identity unavailable; refresh the list')
                row.update(CanTerminate=not bool(reason), BlockReason=reason)
        return result
    except Exception as error:
        raise HTTPException(502, f'{pc}: {error}') from error
    finally:
        with LOCK:
            ACTIVE.remove(pc)
            SLOTS.release()
