"""Explicit, fixed-service administration through the existing WMI transport."""
import json
from fastapi import HTTPException

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
