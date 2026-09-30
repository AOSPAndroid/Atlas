"""Manual, read-only AD queries using the Atlas host's Windows identity."""
import json
import re
import secrets
import subprocess
from pathlib import Path
from typing import Literal
from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

class Lookup(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['user', 'computer']
    identity: str = Field(min_length=1, max_length=128)
    server: str = Field(default='', max_length=128)

def script_for(body):
    identity, server = body.identity.strip(), body.server.strip()
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.@$\\-]{0,127}', identity):
        raise HTTPException(400, 'Enter an exact account, DOMAIN\\account, UPN, or computer name')
    if '\\' in identity:
        parts = identity.split('\\')
        if len(parts) != 2 or not all(parts):
            raise HTTPException(400, 'Invalid domain account')
        domain, identity = parts
        server = server or domain
    if server and not re.fullmatch(r'(?![-.])(?!.*\.\.)[A-Za-z0-9_.-]{1,128}', server):
        raise HTTPException(400, 'Enter a domain or domain-controller hostname')
    # Validated values are additionally quoted as PowerShell literals.
    quote = lambda s: "'" + s.replace("'", "''") + "'"
    return '$kind=' + quote(body.kind) + ';$identity=' + quote(identity) + ';$server=' + quote(server) + ';' + (Path(__file__).parent/'scripts/active_directory.ps1').read_text(encoding='utf-8')

def lookup(body, powershell):
    script = script_for(body)
    try:
        output = powershell(script, timeout=35)
        if len(output) > 1000000:
            raise ValueError('AD response exceeds the display limit')
        result = json.loads(output)
        if not isinstance(result, dict) or not isinstance(result.get('details'), dict) or not isinstance(result.get('groups'), list):
            raise ValueError('Unexpected directory response')
        return result
    except subprocess.TimeoutExpired:
        raise HTTPException(504, 'AD lookup timed out. Check domain connectivity and the selected server.')
    except Exception as error:
        raise HTTPException(502, 'AD lookup failed: ' + str(error)[:1200]) from error

def register(app, powershell):
    @app.post('/api/active-directory/lookup')
    def query(body: Lookup, request: Request):
        from atlas_api import TOKEN
        if not secrets.compare_digest(request.headers.get('x-atlas-token', ''), TOKEN):
            raise HTTPException(403, 'Refresh Atlas before querying Active Directory')
        return lookup(body, powershell)
