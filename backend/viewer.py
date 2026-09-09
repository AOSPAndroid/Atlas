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

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / 'office_atlas.db'
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
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Content-Security-Policy'] = "frame-ancestors 'self'"
    return response


@app.get('/api/health')
def health():
    with connect() as con:
        con.execute('select body from official_records limit 1').fetchone()
    return {'application': 'Office Atlas', 'mode': 'viewer', 'version': '6.7', 'read_only': True, 'instance_id': os.environ.get('ATLAS_INSTANCE_ID')}


@app.get('/api/capabilities')
def capabilities():
    return {'read_only': True, 'elevated_operations': False}


@app.get('/api/official/state')
def state():
    with connect() as con:
        return {'read_only': True, 'records': [json.loads(r[0]) for r in con.execute('select body from official_records order by id')],
                'legacy': [json.loads(r[0]) for r in con.execute('select body from records order by id')],
                'mappings': dict(con.execute('select legacy_id,official_id from official_seating_mappings'))}


@app.get('/api/search')
def search(term: str):
    with connect() as con:
        return search_directory(con, term)


@app.get('/api/user/{uid}')
def user(uid: str):
    with connect() as con:
        rows = con.execute('select * from legacy_users where id=?', (int(uid[3:]),)).fetchall() if uid.startswith('id:') and uid[3:].isdigit() else exact_users(con, uid)
        if not rows:
            raise HTTPException(404, 'User not found')
        if len(rows) != 1:
            raise HTTPException(409, 'Select a user from search results')
        person = dict(rows[0])
        links = [r[0] for r in con.execute('select distinct o.id from desk_user_links l left join official_seating_mappings m on m.legacy_id=l.desk_id join official_records o on o.id=coalesce(m.official_id,l.desk_id) where l.user_key=?', (person['canonical_key'],))]
        return {'user': person, 'machines': linked_machines(con, person['id']), 'desks': links}


@app.get('/api/desks/{desk_id}/context')
def context(desk_id: str):
    with connect() as con:
        row = con.execute('select body from official_records where id=? union all select body from records where id=? limit 1', (desk_id, desk_id)).fetchone()
        if not row:
            raise HTTPException(404, 'Desk not found')
        desk = json.loads(row[0])
        link = con.execute('select user_key from desk_user_links where desk_id=?', (desk_id,)).fetchone()
        candidates = []
        if desk.get('occupancy') != 'vacant':
            candidates = con.execute('select * from legacy_users where canonical_key=?', (link[0],)).fetchall() if link else exact_users(con, desk['name'])
        person = dict(candidates[0]) if len(candidates) == 1 else None
        machines = linked_machines(con, person['id']) if person else []
        hostname = desk.get('hostname', '').strip()
        if hostname and not any(m['name'].casefold() == hostname.casefold() for m in machines):
            machine = con.execute('select * from legacy_machines where name_norm=?', (hostname.casefold(),)).fetchone()
            machines.insert(0, dict(machine) if machine else {'name': hostname, 'match_type': 'Desk equipment'})
        return {'desk': desk, 'user': person, 'candidates': [dict(r) for r in candidates], 'machines': machines,
                'match_method': 'confirmed' if link and person else 'name-match' if person else 'unmatched'}


@app.get('/')
def home():
    html = (ATLAS / 'official-index.html').read_text(encoding='utf-8')
    html = re.sub(r'<(?:script|link)\b[^>]*(?:src|href)="/assets/machine-health[^"]*"[^>]*>(?:</script>)?', '', html)
    # The mode is supplied by this server, never by a URL or browser preference.
    html = html.replace('<head>', '<head><meta name="atlas-mode" content="viewer"><link rel="stylesheet" href="/viewer.css">')
    return HTMLResponse(html)


@app.get('/{filename}')
def asset(filename: str):
    allowed = {'official-app.js', 'official-data.json', 'official.css', 'style.css', 'operations.css', 'viewer.js', 'viewer.css'}
    if filename not in allowed and not re.fullmatch(r'(official-floor-(-1|[0-8])\.(jpg|pdf)|studio-floor-(-1|[0-8])\.svg)', filename):
        raise HTTPException(404, 'Not available in the shared viewer')
    return FileResponse(ATLAS / filename)
