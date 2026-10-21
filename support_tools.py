"""Support tools for a request's PC and person (Live Inbox request tools, Admin only):

- a one-click PC check-up: who is signed in, crashes, unexpected shutdowns and app hangs, disk errors,
  a pending restart and why, recent Windows updates, network adapters (scripts/support_diagnose.ps1);
- a message on the PC's screen (msg.exe), a restart scheduled for later with a warning or cancelled
  (shutdown.exe), and a Group Policy refresh (gpupdate), each started over WMI after a click;
- unlocking a locked-out AD account, and the BitLocker recovery keys AD keeps for a PC (each read is
  logged with the operator, never the key);
- notes kept on people and PCs, shown wherever they come up.
"""
import base64
import json
import logging
import os
import subprocess
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Literal

from fastapi import HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

SCRIPT = Path(__file__).parent / 'scripts' / 'support_diagnose.ps1'
ACTIVE, LOCK = set(), threading.Lock()
TEXT = r'^[^\x00-\x09\x0b-\x1f]*$'  # Printable text and line breaks.
SERVER = r'^(?:[A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*)?$'  # A domain or controller name, or empty.


class Message(BaseModel):
    model_config = ConfigDict(extra='forbid')
    computer: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=255, pattern=TEXT)
    seconds: int = Field(300, ge=30, le=3600)


class Restart(BaseModel):
    model_config = ConfigDict(extra='forbid')
    computer: str = Field(min_length=1, max_length=64)
    minutes: int | None = Field(None, ge=1, le=1440)
    at: str | None = Field(None, pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    message: str = Field('', max_length=200, pattern=TEXT)


class Machine(BaseModel):
    model_config = ConfigDict(extra='forbid')
    computer: str = Field(min_length=1, max_length=64)


class Account(BaseModel):
    model_config = ConfigDict(extra='forbid')
    identity: str = Field(min_length=1, max_length=256, pattern=r'^[^\x00-\x1f]+$')
    server: str = Field('', max_length=128, pattern=SERVER)


class Computer(BaseModel):
    model_config = ConfigDict(extra='forbid')
    computer: str = Field(min_length=1, max_length=64)
    server: str = Field('', max_length=128, pattern=SERVER)


class Note(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['user', 'machine']
    key: str = Field(min_length=1, max_length=200)
    text: str = Field('', max_length=4000)


def one_line(text):
    """msg.exe and shutdown.exe take the text on their command line: no quotes, one line."""
    return ' '.join(str(text).replace('"', "'").split())


def message_command(text, seconds):
    return f'msg.exe * /TIME:{int(seconds)} {one_line(text)}'


def restart_command(seconds, message=''):
    comment = one_line(message or 'Atlas: this PC restarts for IT support. Save your work.')[:200]
    return f'shutdown.exe /r /t {int(seconds)} /d p:0:0 /c "{comment}"'


def seconds_until(body, now=None):
    """Seconds to the restart: in N minutes, or at HH:MM today (tomorrow if already past)."""
    if (body.minutes is None) == (body.at is None):
        raise HTTPException(422, 'Choose either a number of minutes or a time.')
    if body.minutes is not None:
        return body.minutes * 60
    now = now or datetime.now()
    hour, minute = map(int, body.at.split(':'))
    when = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if when <= now:
        when += timedelta(days=1)
    return int((when - now).total_seconds())


class Notes:
    """Notes on people (by their directory key) and PCs (by name), in data/support-notes.json."""

    def __init__(self, path):
        self._path, self.lock = path, threading.Lock()

    @property
    def path(self):
        return Path(self._path() if callable(self._path) else self._path)

    def load(self):
        try:
            data = json.loads(self.path.read_text(encoding='utf-8'))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def get(self, kind, key):
        return self.load().get(f'{kind}:{key.casefold()}') if key else None

    def save(self, kind, key, text, by=''):
        with self.lock:
            data = self.load()
            name = f'{kind}:{key.casefold()}'
            if text.strip():
                data[name] = {'text': text.strip(), 'updated': datetime.now().isoformat(timespec='seconds'), 'by': by}
            else:
                data.pop(name, None)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix('.tmp')
            temporary.write_text(json.dumps(data, indent=1), encoding='utf-8')
            os.replace(temporary, self.path)
            return data.get(name)


def ad_script(body, script):
    """Inputs travel as JSON in base64, never spliced into the PowerShell text."""
    encoded = base64.b64encode(json.dumps(body).encode('utf-8')).decode('ascii')
    return ("$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'\n"
            "trap { @{error=$_.Exception.Message} | ConvertTo-Json -Compress; exit 0 }\n"
            "if (!(Get-Module -ListAvailable ActiveDirectory)) { throw 'Install the RSAT Active Directory PowerShell module on the Atlas host.' }\n"
            "Import-Module ActiveDirectory -ErrorAction Stop\n"
            f"$request=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{encoded}')) | ConvertFrom-Json\n"
            "$opts=@{}; if($request.server){$opts.Server=$request.server}\n" + script)


UNLOCK = r"""$value=[string]$request.identity
if($value.Contains('@')){ $escaped=$value.Replace("'","''"); $user=Get-ADUser -Filter "UserPrincipalName -eq '$escaped' -or mail -eq '$escaped'" -Properties LockedOut @opts | Select-Object -First 1 }
else { $user=Get-ADUser -Identity $value -Properties LockedOut @opts }
if(!$user){ throw "No AD account matches $value." }
Unlock-ADAccount -Identity $user.DistinguishedName @opts
$after=Get-ADUser -Identity $user.DistinguishedName -Properties LockedOut @opts
@{account=$user.SamAccountName; was_locked=[bool]$user.LockedOut; locked=[bool]$after.LockedOut} | ConvertTo-Json -Compress
"""

BITLOCKER = r"""$computer=Get-ADComputer -Identity ([string]$request.computer) @opts
$keys=@(Get-ADObject -Filter "objectClass -eq 'msFVE-RecoveryInformation'" -SearchBase $computer.DistinguishedName -Properties 'msFVE-RecoveryPassword','whenCreated' @opts | Sort-Object whenCreated -Descending | ForEach-Object {
 @{id=($_.Name -replace '^.*\{([0-9A-Fa-f-]+)\}$','$1').ToUpperInvariant(); created=$_.whenCreated.ToUniversalTime().ToString('o'); password=[string]$_.'msFVE-RecoveryPassword'} })
@{computer=$computer.Name; keys=$keys} | ConvertTo-Json -Depth 4 -Compress
"""


def run_ad(wmi, body, script, what):
    from active_directory import readable_error
    try:
        result = json.loads(wmi.ps(ad_script(body, script), timeout=35))
    except subprocess.TimeoutExpired as error:
        raise HTTPException(504, f'{what} timed out. Check domain connectivity.') from error
    except Exception as error:
        raise HTTPException(502, f'{what} failed: {readable_error(error)}') from error
    if not isinstance(result, dict):
        raise HTTPException(502, f'{what} failed: unexpected directory response.')
    if result.get('error'):
        raise HTTPException(502, f"{what} failed: {readable_error(result['error'])}")
    return result


def diagnose(wmi, pc, days=7):
    pc = wmi.validate_pc(pc)
    with LOCK:
        if pc in ACTIVE:
            raise HTTPException(429, f'A check-up of {pc} is already running.')
        ACTIVE.add(pc)
    started = time.monotonic()
    try:
        args = ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(SCRIPT),
                '-Computer', pc, '-Days', str(int(days))]
        result = json.loads(wmi.run(args, timeout=90).stdout)
        if not isinstance(result, dict):
            raise ValueError('Invalid check-up result')
        if not result.get('ok'):
            raise ValueError(result.get('error') or 'The PC did not answer.')
        # PowerShell unrolls a one-adapter list into the adapter itself.
        network = result.get('network')
        result['network'] = [network] if isinstance(network, dict) else network or []
        result['duration_ms'] = round((time.monotonic() - started) * 1000)
        return result
    except subprocess.TimeoutExpired as error:
        raise HTTPException(504, f'{pc} did not answer within 90 seconds.') from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(502, f'{pc}: {error}') from error
    finally:
        with LOCK:
            ACTIVE.discard(pc)


notes = None


def register(app, wmi, check_token, notes_path=None):
    global notes
    if notes_path is None:
        from runtime_paths import support_notes_path
        notes_path = support_notes_path
    notes = Notes(notes_path)

    def operator():
        try:
            return wmi.identity()
        except Exception:
            return ''

    @app.get('/api/diagnose/{pc}')
    def check_up(pc: str, days: int = Query(7, ge=1, le=30)):
        return diagnose(wmi, pc, days)

    @app.post('/api/support/message')
    def message(body: Message, request: Request):
        check_token(request)
        pc = wmi.validate_pc(body.computer)
        pid = wmi.wmi_create(pc, message_command(body.text, body.seconds))
        logging.info('Screen message sent target=%s operator=%s', pc, operator())
        return {'computer': pc, 'pid': pid, 'seconds': body.seconds}

    @app.post('/api/support/restart')
    def restart(body: Restart, request: Request):
        check_token(request)
        pc = wmi.validate_pc(body.computer)
        seconds = seconds_until(body)
        wmi.job_service.target_ready(pc)  # Never while a deployment to this PC is running.
        pid = wmi.wmi_create(pc, restart_command(seconds, body.message))
        at = (datetime.now() + timedelta(seconds=seconds)).isoformat(timespec='minutes')
        logging.info('Restart scheduled target=%s at=%s operator=%s', pc, at, operator())
        return {'computer': pc, 'pid': pid, 'seconds': seconds, 'at': at}

    @app.post('/api/support/restart/cancel')
    def cancel_restart(body: Machine, request: Request):
        check_token(request)
        pc = wmi.validate_pc(body.computer)
        pid = wmi.wmi_create(pc, 'shutdown.exe /a')
        logging.info('Scheduled restart cancelled target=%s operator=%s', pc, operator())
        return {'computer': pc, 'pid': pid, 'cancelled': True}

    @app.post('/api/support/gpupdate')
    def gpupdate(body: Machine, request: Request):
        check_token(request)
        pc = wmi.validate_pc(body.computer)
        pid = wmi.wmi_create(pc, 'gpupdate.exe /target:computer /force')
        logging.info('Group Policy refresh started target=%s operator=%s', pc, operator())
        return {'computer': pc, 'pid': pid}

    @app.post('/api/support/unlock')
    def unlock(body: Account, request: Request):
        check_token(request)
        result = run_ad(wmi, body.model_dump(), UNLOCK, 'Unlock')
        logging.info('AD account unlocked account=%s operator=%s', result.get('account'), operator())
        return result

    @app.post('/api/support/bitlocker')
    def bitlocker(body: Computer, request: Request):
        check_token(request)
        pc = wmi.validate_pc(body.computer)
        result = run_ad(wmi, {**body.model_dump(), 'computer': pc}, BITLOCKER, 'BitLocker lookup')
        keys = result.get('keys') or []
        result['keys'] = [keys] if isinstance(keys, dict) else keys
        logging.info('BitLocker recovery keys read target=%s keys=%s operator=%s', pc, len(result['keys']), operator())
        return result

    @app.get('/api/support/notes')
    def read_notes(user: str = Query('', max_length=200), machine: str = Query('', max_length=64)):
        return {'user': notes.get('user', user), 'machine': notes.get('machine', machine.upper())}

    @app.put('/api/support/notes')
    def write_notes(body: Note, request: Request):
        check_token(request)
        key = body.key.upper() if body.kind == 'machine' else body.key
        return {'kind': body.kind, 'key': key, 'note': notes.save(body.kind, key, body.text, operator())}

    return notes
