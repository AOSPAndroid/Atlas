"""Database-only desk identity evidence shared by admin, viewer and palette."""
import json
import re
import threading
import unicodedata
from directory_lookup import linked_machines


def name_key(value):
    return ' '.join(sorted(re.findall(r'[^\W_]+', unicodedata.normalize('NFKC', str(value)).casefold())))


_indexes = {}
_lock = threading.Lock()


def resolve_person(c, desk):
    if desk['occupancy'] == 'vacant':
        return [], 'unassigned'
    explicit = c.execute('select user_key from desk_user_links where desk_id=?', (desk['id'],)).fetchone()
    if explicit:
        person = c.execute('select * from legacy_users where canonical_key=?', (explicit[0],)).fetchone()
        return ([dict(person)] if person else []), ('confirmed' if person else 'missing-linked-user')
    key = name_key(desk['name'])
    if len(key.split()) < 2:
        return [], 'unmatched'
    path = c.execute('pragma database_list').fetchone()[2]
    stamp = tuple(c.execute("select key,value from metadata where key in ('directory.created_at','created_at') order by key").fetchall())
    cache_key = (path or id(c), tuple(tuple(row) for row in stamp))
    with _lock:
        index = _indexes.get(cache_key)
        if index is None:
            index = {}
            for uid, name in c.execute('select id,full_name from legacy_users'):
                index.setdefault(name_key(name), []).append(uid)
            if len(_indexes) >= 8:
                _indexes.pop(next(iter(_indexes)))
            _indexes[cache_key] = index
    ids = index.get(key, [])
    people = [dict(row) for row in c.execute('select * from legacy_users where id in ('+','.join('?' for _ in ids)+') order by id', ids)] if ids else []
    method = ('unconfirmed-name-match' if desk['occupancy']=='unconfirmed' else 'name-match') if len(people)==1 else 'ambiguous' if people else 'unmatched'
    return people, method


def desk_context(c, desk):
    candidates, method = resolve_person(c, desk)
    person = candidates[0] if len(candidates)==1 else None
    machines = linked_machines(c, person['id']) if person else []
    for machine in machines:
        machine['link_source'] = 'User directory'
    hostname = desk.get('hostname','').strip().upper() if desk['kind']=='desk' else ''
    if hostname:
        existing = next((m for m in machines if m['name'].upper()==hostname), None)
        if existing:
            existing['desk_equipment'] = True
        else:
            row = c.execute('select * from legacy_machines where name_norm=?', (hostname.lower(),)).fetchone()
            machine = dict(row) if row else {'name':hostname,'operational_status':'Not in directory','model_id':'','serial_number':''}
            machine.update(link_source='Desk equipment record',match_type='Recorded at this desk',desk_equipment=True,assigned_relationship=0,logon_relationship=0)
            machines.insert(0, machine)
    for machine in machines:
        machine['relationship_group'] = 'Desk equipment' if machine.get('desk_equipment') else 'Assigned to user' if machine.get('assigned_relationship') else 'Last logged on (inventory)'
        machine['inventory_discovered_at'] = machine.get('last_discovered') or None
        machine['inventory_updated_at'] = machine.get('updated_on') or None
    order = {'Desk equipment':0,'Assigned to user':1,'Last logged on (inventory)':2}
    machines.sort(key=lambda m:(order[m['relationship_group']], m['name']))
    return {'desk':desk,'user':person,'candidates':candidates,'match_method':method,'machines':machines}


def person_desks(c, person, suggestions=True):
    rows = c.execute('select distinct o.id,o.body from desk_user_links l left join official_seating_mappings m on m.legacy_id=l.desk_id join official_records o on o.id=coalesce(m.official_id,l.desk_id) where l.user_key=?', (person['canonical_key'],)).fetchall()
    if rows:
        return [{'id':row[0],'floor':json.loads(row[1])['floor'],'match':'confirmed account link'} for row in rows]
    if not suggestions:
        return []
    key = name_key(person['full_name'])
    linked = dict(c.execute('select desk_id,user_key from desk_user_links'))
    return [{'id':desk['id'],'floor':desk['floor'],'match':'matching name; account not confirmed'} for (body,) in c.execute('select body from official_records') for desk in [json.loads(body)] if desk.get('occupancy')!='vacant' and key and name_key(desk['name'])==key and desk['id'] not in linked]
