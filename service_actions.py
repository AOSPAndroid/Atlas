"""Explicit service administration through the existing WMI transport."""
import json
import logging
import re
from pathlib import Path
from fastapi import HTTPException

MANAGE_SCRIPT = (Path(__file__).parent / 'scripts' / 'remote_services.ps1').read_text(encoding='utf-8')

SCRIPT = r"""
$ErrorActionPreference='Stop'
$s=Get-WmiObject -ComputerName $pc -Class Win32_Service -Filter "Name='RemoteRegistry'" -ErrorAction Stop
if(!$s){throw 'Remote Registry service was not found'}
$before=$s.State
$mode=$s.StartMode
if($s.StartMode -eq 'Disabled') {
 $code=$s.ChangeStartMode('Manual').ReturnValue
 if($code -ne 0){throw "Could not enable Remote Registry (service code $code). Check remote administrator rights and policy."}
 $s.Get()
}
if($s.State -ne 'Running') {
 $code=$s.StartService().ReturnValue
 if($code -notin @(0,10)){throw "Could not start Remote Registry (service code $code). Check remote administrator rights and policy."}
 for($i=0; $i -lt 20 -and $s.State -ne 'Running'; $i++) {Start-Sleep -Milliseconds 250; $s.Get()}
}
if($s.State -ne 'Running'){throw "Remote Registry has not reached Running (state: $($s.State), startup: $($s.StartMode)). Refresh or check Services on the target."}
@{computer=$pc;service='RemoteRegistry';state=$s.State;start_mode=$s.StartMode;previous_state=$before;previous_start_mode=$mode} | ConvertTo-Json -Compress
"""

def enable_remote_registry(wmi, computer):
    pc=wmi.validate_pc(computer)
    try:
        result=json.loads(wmi.ps('$pc='+wmi.quote(pc)+';'+SCRIPT,timeout=30))
        if (not isinstance(result,dict) or result.get('computer','').upper()!=pc.upper()
                or result.get('service')!='RemoteRegistry' or result.get('state')!='Running'):
            raise ValueError('Remote Registry did not return a verified running state')
        return result
    except Exception as error:
        raise HTTPException(502,f'{pc}: {error}') from error


def _manage(wmi, pc, action, **parameters):
    arguments = ' '.join(f'-{key} {wmi.quote(value)}' for key, value in parameters.items())
    try:
        output = wmi.ps(f'& {{\n{MANAGE_SCRIPT}\n}} -Computer {wmi.quote(pc)} -Action {wmi.quote(action)} {arguments}', timeout=60)
        result = json.loads(output)
        if not isinstance(result, dict) or not result.get('ok'):
            raise ValueError(result.get('error', 'Invalid Windows response') if isinstance(result, dict) else 'Invalid Windows response')
        if result.get('computer', '').upper() != pc.upper():
            raise ValueError('Windows returned a different target')
        return result
    except Exception as error:
        suffix = ' Refresh services before retrying; the stop outcome may be unknown.' if action == 'stop' else ''
        raise HTTPException(502, f'{pc}: {error}{suffix}') from error


def list_services(wmi, computer):
    pc = wmi.validate_pc(computer)
    result = _manage(wmi, pc, 'list')
    if not isinstance(result.get('items'), list):
        raise HTTPException(502, f'{pc}: Windows returned an invalid service list')
    return result


def stop_service(wmi, request):
    pc = wmi.validate_pc(request.computer)
    name, expected = request.name, request.expected_identity
    if (not isinstance(name, str) or not 1 <= len(name) <= 256
            or any(ord(c) < 32 for c in name) or not isinstance(expected, str)
            or not re.fullmatch(r'[a-f0-9]{64}', expected)):
        raise HTTPException(400, 'Refresh services and choose a service from the list')
    operator = wmi.identity()
    try:
        result = _manage(wmi, pc, 'stop', Name=name, ExpectedIdentity=expected)
        if (result.get('name', '').casefold() != name.casefold()
                or result.get('outcome') not in ('stopped', 'already_stopped', 'pending', 'blocked', 'changed', 'gone', 'failed')
                or (result['outcome'] in ('stopped', 'already_stopped') and result.get('state') != 'Stopped')):
            raise HTTPException(502, f'{pc}: Windows did not verify the service outcome. Refresh services before retrying.')
        logging.warning('Service stop target=%s service=%s outcome=%s state=%s operator=%s', pc, name, result['outcome'], result.get('state'), operator)
        return result
    except Exception:
        logging.exception('Service stop outcome unavailable target=%s service=%s operator=%s', pc, name, operator)
        raise
