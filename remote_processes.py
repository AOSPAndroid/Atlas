"""Remote process snapshots and checked termination through the existing WMI transport."""
import json
import logging
import re
from pathlib import Path

from fastapi import HTTPException

SCRIPT = (Path(__file__).parent / 'scripts' / 'remote_processes.ps1').read_text(encoding='utf-8')


def call(wmi, pc, **parameters):
    arguments = ' '.join(f'-{key} {wmi.quote(value)}' for key, value in parameters.items())
    try:
        output = wmi.ps(f'& {{\n{SCRIPT}\n}} -Computer {wmi.quote(pc)} {arguments}', timeout=60)
        result = json.loads(output)
        if not isinstance(result, dict) or not result.get('ok'):
            raise RuntimeError(result.get('error', 'Windows returned no result') if isinstance(result, dict) else 'Invalid Windows response')
    except Exception as error:
        suffix = ' Refresh the list before retrying; the outcome may be unknown.' if parameters.get('Action') == 'kill' else ''
        raise HTTPException(502, f'{pc}: {error}{suffix}') from error
    return result


def list_processes(wmi, pc, kind):
    pc = wmi.validate_pc(pc)
    if kind not in ('cpu', 'memory', 'gpu'):
        raise HTTPException(400, 'Choose CPU, GPU or Memory')
    return call(wmi, pc, Action='list', Kind=kind)['items']


def terminate(wmi, request):
    pc = wmi.validate_pc(request.computer)
    value = request.value.strip()
    if not re.fullmatch(r'[A-Za-z0-9_. -]{1,260}', value):
        raise HTTPException(400, 'Invalid PID or executable name')
    if value.isdigit():
        if not 4 < int(value) <= 4294967295:
            raise HTTPException(400, 'Choose a valid non-system PID')
        value = str(int(value))
    elif not value.lower().endswith('.exe'):
        value += '.exe'
    created, name = request.created, request.name
    if created is not None or name is not None:
        if (not value.isdigit() or not created or not name
                or not re.fullmatch(r'\d{14}\.\d{6}[+-]\d{3}', created)
                or len(name) > 260 or any(c in name for c in '\r\n\x00')):
            raise HTTPException(400, 'Refresh the process list to obtain its identity')
    operator = wmi.identity()
    result = call(wmi, pc, Action='kill', Value=value, ExpectedCreated=created or '', ExpectedName=name or '')
    logging.warning('Process termination target=%s value=%s result=%s operator=%s', pc, value, result, operator)
    return result
