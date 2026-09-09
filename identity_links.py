"""Conservative identity matching shared by import and lookup."""
import re
from collections import defaultdict

def key(value):
    return re.sub(r'\s+', ' ', str(value or '').strip()).casefold()

def identifier(value):
    return key(value).rsplit('\\', 1)[-1]

def build_index(c):
    index = defaultdict(set)
    for row in c.execute('select id,user_id,email,employee_number,full_name from users'):
        uid, login, email, employee, name = row
        for value in (login, email, employee, name):
            if key(value): index[key(value)].add(uid)
        if identifier(login): index[identifier(login)].add(uid)
    for uid, value in c.execute("select user_id_ref,alias_norm from user_aliases where alias_type != 'name'"):
        if key(value): index[key(value)].add(uid)
    return index

def candidates(index, value):
    text = key(value)
    if text in ('', 'none', 'unknown', 'n/a', 'no user', 'no brid', '0'): return set()
    return index.get(text, set()) or index.get(identifier(text), set())

def rebuild_links(c):
    index = build_index(c)
    c.execute('delete from assignments')
    linked = ambiguous = unmatched = 0
    for mid, assigned, logged in c.execute('select id,assigned_to,last_logon_user from machines').fetchall():
        for kind, value in [('assigned_to', assigned), ('last_logon_user', logged)]:
            if not key(value): continue
            ids = candidates(index, value)
            if len(ids) == 1:
                c.execute('insert or ignore into assignments(user_id_ref,machine_id,relationship_type,source_value) values(?,?,?,?)', (next(iter(ids)), mid, kind, value))
                linked += 1
            elif ids: ambiguous += 1
            else: unmatched += 1
    return {'linked': linked, 'ambiguous': ambiguous, 'unmatched': unmatched}
