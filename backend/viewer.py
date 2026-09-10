"""LAN viewer: only explicit read routes, with read-only SQLite connections.

Never import backend.main here: its startup registers administrative operations
and performs database migrations. The launcher starts that process first.
"""
import os
import json
import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from directory_lookup import exact_users, linked_machines, search_directory, prepare_views
from desk_directory import desk_context,person_desks,machine_context
import directory_exports

ROOT = Path(__file__).resolve().parent.parent
from runtime_paths import database_path
DB = database_path()
ATLAS = ROOT / 'atlas'
app = FastAPI(title='Atlas read-only viewer', docs_url=None, redoc_url=None, openapi_url=None)


@contextmanager
def connect():
    con = sqlite3.connect(DB.resolve().as_uri() + '?mode=ro', uri=True, timeout=20)
    con.row_factory = sqlite3.Row
    prepare_views(con)
    con.execute('PRAGMA query_only=ON')
    try:
        yield con
    finally:
        con.close()


@app.middleware('http')
async def read_only(request: Request, call_next):
    if request.method not in ('GET', 'HEAD'):
        return JSONResponse({'detail': 'This shared Atlas is read only. Changes and remote operations require the local admin version.'}, status_code=403)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store' if request.url.path.startswith('/api/') or request.url.path=='/' else 'public, max-age=0, must-revalidate'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Content-Security-Policy'] = "frame-ancestors 'self'"
    return response


@app.get('/api/health')
def health():
    with connect() as con:
        con.execute('select body from official_records limit 1').fetchone()
    return {'application': 'Office Atlas', 'mode': 'viewer', 'version': '6.9.1', 'read_only': True, 'instance_id': os.environ.get('ATLAS_INSTANCE_ID')}


@app.get('/api/capabilities')
def capabilities():
    return {'read_only': True, 'elevated_operations': False}


@app.get('/api/official/state')
def state():
    with connect() as con:
        return {'read_only': True, 'records': [dict(json.loads(r[0]),layout='official') for r in con.execute('select body from official_records order by id')],
                'legacy': [json.loads(r[0]) for r in con.execute('select body from records order by id')],
                'mappings': dict(con.execute('select legacy_id,official_id from official_seating_mappings'))}


@app.get('/api/search')
def search(term: str):
    with connect() as con:
        return search_directory(con, term)


@app.get('/api/directory/record')
def export_record(kind: str, key: str):
    with connect() as con:
        try:
            result = directory_exports.record(con, kind, key, include_unmapped=False)
        except ValueError as error:
            raise HTTPException(400, str(error))
        if result is None:
            raise HTTPException(404, 'Directory record not found')
        return result


@app.get('/api/user/{uid}')
def user(uid: str):
    with connect() as con:
        rows = con.execute('select * from legacy_users where id=?', (int(uid[3:]),)).fetchall() if uid.startswith('id:') and uid[3:].isdigit() else exact_users(con, uid)
        if not rows:
            raise HTTPException(404, 'User not found')
        if len(rows) != 1:
            raise HTTPException(409, 'Select a user from search results')
        person = dict(rows[0])
        desks=person_desks(con,person)
        return {'user': person, 'machines': linked_machines(con, person['id']), 'desks':[d['id'] for d in desks], 'desk_matches':desks}



@app.get('/api/desks/{desk_id}/context')
def context(desk_id: str):
    with connect() as con:
        row = con.execute('select body from official_records where id=? union all select body from records where id=? limit 1', (desk_id, desk_id)).fetchone()
        if not row:
            raise HTTPException(404, 'Desk not found')
        desk = json.loads(row[0])
        return desk_context(con, desk)


@app.get('/api/palette/person/{uid}')
def palette_person(uid: str):
    if not uid.startswith('id:') or not uid[3:].isdigit():
        raise HTTPException(400, 'Select a directory result')
    with connect() as con:
        person = con.execute('select * from legacy_users where id=?', (int(uid[3:]),)).fetchone()
        if not person:
            raise HTTPException(404, 'Person not found')
        return {'desks': person_desks(con, person)}


@app.get('/api/machine/{computer}')
def machine(computer: str):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,63}', computer) or '..' in computer:
        raise HTTPException(400, 'Invalid computer name')
    with connect() as con:
        result = machine_context(con, computer)
        if result is None:
            raise HTTPException(404, 'Machine not found in directory')
        return result


@app.get('/')
def home():
    html = (ATLAS / 'official-index.html').read_text(encoding='utf-8')
    html = re.sub(r'<(?:script|link)\b[^>]*(?:src|href)="/assets/(?:machine-health|client)[^"]*"[^>]*>(?:</script>)?', '', html)
    # The mode is supplied by this server, never by a URL or browser preference.
    html = html.replace('<head>', '<head><meta name="atlas-mode" content="viewer"><link rel="stylesheet" href="/viewer.css">')
    html = html.replace('<span>Atlas</span>', '<span>Atlas</span><span class="atlas-demo-badge">Demo</span>', 1)
    html = html.replace('aria-label="Atlas home"', 'aria-label="Atlas Demo home"', 1)
    return HTMLResponse(html)


@app.get('/assets/{filename}')
def shared_asset(filename:str):
    if filename not in ('shared-ui.js','ui-tokens.css','atlas-shell.css','barclays-eagle.svg','catalogue.css'):raise HTTPException(404,'Not available')
    return FileResponse(ROOT/'frontend/assets'/filename)


@app.get('/{filename}')
def asset(filename: str):
    allowed = {'command-palette.js', 'command-palette.css', 'command-registry.js', 'official-app.js','camera-motion.js','map-cursor.js', 'official-data.json', 'official.css', 'style.css', 'operations.css', 'viewer.js', 'viewer.css'}
    if filename not in allowed and not re.fullmatch(r'(official-floor-(-1|[0-8])\.(jpg|pdf)|studio-floor-(-1|[0-8])\.svg)', filename):
        raise HTTPException(404, 'Not available in the shared viewer')
    return FileResponse(ATLAS / filename)
