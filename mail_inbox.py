"""Local Admin inbox reads and directory joins. Never registered on the LAN viewer."""
from contextlib import contextmanager
from datetime import datetime
import os
from pathlib import Path
import re
import sqlite3

from fastapi import Body, HTTPException, Query, Request
from directory_lookup import exact_users, linked_machines
from outlook_watcher import default_directory, status, utcnow
from notification_inbox import notification_status, source_columns


def mail_directory():
    import companion_server
    if companion_server.companion and companion_server.companion.inbox_active():
        return companion_server.companion.inbox
    from inbox_control import InboxIntegration, IntegrationError
    try:
        configured = InboxIntegration().config()
        if configured:
            return Path(configured['directory']).resolve()
    except IntegrationError as error:
        raise HTTPException(503, str(error)) from error
    return Path(os.environ.get('ATLAS_MAIL_DIR') or default_directory()).expanduser().resolve()


@contextmanager
def queue_reader(directory):
    path = directory / 'inbox.sqlite3'
    connection = None
    try:
        if not path.is_file():
            yield None
            return
        connection = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=2)
        connection.row_factory = sqlite3.Row
        connection.execute('PRAGMA query_only=ON')
        connection.execute('BEGIN')
        yield connection
    except sqlite3.Error as error:
        raise HTTPException(503, 'The local mail queue is unavailable. Check the configured folder and read access for the Atlas Windows account, then retry.') from error
    except PermissionError as error:
        raise HTTPException(503, 'The Atlas Windows account needs read access to the configured mail folder.') from error
    finally:
        if connection is not None:
            connection.close()


def watcher_status(directory):
    import companion_server
    if companion_server.companion and companion_server.companion.inbox_active() and directory == companion_server.companion.inbox:
        return companion_server.companion.mail_status()
    try:
        current = status(directory)
    except PermissionError as error:
        raise HTTPException(503, 'The Atlas Windows account needs read access to the mail watcher status and lock files.') from error
    # A process can still hold its lock while Outlook is displaying a prompt.
    try:
        age = (utcnow() - datetime.fromisoformat(current['updated_at'])).total_seconds()
        stale = age > max(60, int(current.get('interval', 5)) * 3)
    except (KeyError, ValueError, TypeError):
        stale = bool(current['running'])
    return {**{key: current.get(key) for key in
               ('state', 'running', 'last_success_at', 'updated_at', 'detail', 'config')},
            'stale': stale, 'interval': current.get('interval', 5)}


def notifications_status(directory):
    """Teams/Outlook notification listener status: the Companion's when it supplies the queue."""
    import companion_server
    if companion_server.companion and companion_server.companion.inbox_active() and directory == companion_server.companion.inbox:
        return companion_server.companion.notification_status()
    return notification_status(directory)


def outlook_actions(directory):
    """Whether Outlook can act on this queue's mail: only mail the Companion supplied, while it runs."""
    import companion_server
    current = companion_server.companion
    return bool(current and directory == current.inbox and current.can('outlook.open'))


def person(row):
    data = dict(row)
    return {key: data.get(key, '') for key in
            ('id', 'canonical_key', 'name', 'full_name', 'user_name', 'email', 'department', 'location', 'job_role')}


def match_sender(connection, message, chosen=None):
    address = message['sender_address'].strip()
    rows = exact_users(connection, address, field='email') if '@' in address else []
    basis = 'email'
    if not rows:
        basis = 'name'
        rows = exact_users(connection, message['sender_name'], field='name')
    people = [person(row) for row in rows]
    kind = basis if len(people) == 1 else 'ambiguous' if people else 'unmatched'
    selected = people[0] if len(people) == 1 else None
    if chosen is not None:
        selected = next((user for user in people if user['id'] == chosen), None)
        if selected is None:
            raise HTTPException(409, 'This person is no longer a candidate for the sender. Refresh the message.')
    return {'kind': kind, 'basis': basis if people else None, 'user': selected,
            'candidates': people, 'chosen': chosen is not None}


# Characters that text recognition (and hurried typing) confuse in hostnames: O/0, I/l/1, S/5, B/8, Z/2.
LOOKALIKE = str.maketrans({'o': '0', 'i': '1', 'l': '1', 's': '5', 'b': '8', 'z': '2'})


def lookalike_key(value):
    return str(value or '').casefold().translate(LOOKALIKE)


def mentioned_machines(connection, names):
    """Machines Atlas knows by these names, found as Workspace search finds them: the inventory name,
    its short name when the inventory keeps the full DNS or DOMAIN\\NAME form, the ServiceNow CI
    name, and Citrix VDIs from the Citrix export. Names with no match are retried with look-alike
    characters made equal, so a misread "GBRPWMK2O88I521" still finds GBRPWMK20881521. Each row keeps
    how it was written ("written"); "written_as" marks a look-alike reading."""
    from directory_lookup import MACHINE_SHORT_SQL
    import vdi_data
    names = list(dict.fromkeys(str(name).casefold() for name in names if name))
    if not names:
        return []
    columns = 'name,name_norm,device_kind,model_id,operational_status,windows_remote_supported'
    rows, seen, missing = [], set(), set(names)

    def add(row, written, lookalike=False):
        missing.discard(written)
        key = str(row.get('vdi_key') or row['name']).casefold()
        if key in seen:
            return
        seen.add(key)
        rows.append({**{k: v for k, v in row.items() if k not in ('name_norm', 'match_key')}, 'written': written.upper(),
                     **({'written_as': written.upper()} if lookalike else {})})

    def place(values):
        return ','.join('?' * len(values))

    for row in connection.execute(f'SELECT {columns} FROM legacy_machines WHERE name_norm IN ({place(names)}) ORDER BY name', names):
        add(dict(row), row['name_norm'])
    if missing:
        # The inventory may keep "pc01.intranet.example" or "INTRANET\PC01" (and a ServiceNow CI name).
        wanted = sorted(missing)
        known = {row[1] for row in connection.execute('pragma table_info(machines)')}
        ci = f' OR lower(source_ci) IN ({place(wanted)})' if 'source_ci' in known else ''
        qualified = connection.execute("SELECT 1 FROM legacy_machines WHERE instr(machine_name,'.')>0 OR instr(machine_name,'\\')>0 LIMIT 1").fetchone()
        if qualified or ci:
            short = f'{MACHINE_SHORT_SQL} IN ({place(wanted)})' if qualified else '0'
            for row in connection.execute(
                    f'SELECT {columns},{MACHINE_SHORT_SQL} AS match_key{", lower(source_ci) AS ci_key" if ci else ""} FROM legacy_machines '
                    f'WHERE {short}{ci} ORDER BY name LIMIT 200', [*(wanted if qualified else []), *(wanted if ci else [])]):
                row = dict(row)
                ci_key = row.pop('ci_key', None)
                written = row['match_key'] if row['match_key'] in missing else ci_key
                if written in missing:
                    add(row, written)
    vdi = vdi_data.exists(connection)

    def citrix(record):
        catalog = record.get('vdi_catalog') or ''
        return {'name': record['name'], 'device_kind': 'vdi', 'model_id': 'Citrix VDI' + (' · ' + catalog if catalog else ''),
                'operational_status': record.get('vdi_registration_state') or 'Citrix', 'windows_remote_supported': record.get('windows_remote_supported'),
                **{k: record.get(k) for k in ('vdi_key', 'source_kind', 'vdi_power_state', 'vdi_delivery_group', 'vdi_assigned_users')}}
    if missing and vdi:
        wanted = sorted(missing)
        for record in vdi_data._read_records(connection, 'select ' + vdi_data.READ_COLUMNS + f' from vdi_devices d where d.short_norm in ({place(wanted)}) '
                                             f'or d.name_norm in ({place(wanted)}) order by d.name_norm limit 200', (*wanted, *wanted)):
            for written in (str(record.get('vdi_short_name') or '').casefold(), str(record.get('name_norm') or '').casefold()):
                if written in missing:
                    add(citrix(record), written)
                    break
    if missing:
        connection.create_function('atlas_lookalike', 1, lookalike_key, deterministic=True)
        wanted = {lookalike_key(name): name for name in missing}
        lengths = sorted({len(name) for name in wanted.values()})
        for row in connection.execute(
                f'SELECT {columns} FROM legacy_machines WHERE length(name_norm) IN ({place(lengths)}) AND atlas_lookalike(name_norm) IN ({place(wanted)}) '
                'ORDER BY name LIMIT 20', (*lengths, *wanted)):
            add(dict(row), wanted[lookalike_key(row['name_norm'])], lookalike=True)
        left = {key: name for key, name in wanted.items() if name in missing}
        if left and vdi:
            for record in vdi_data._read_records(connection, 'select ' + vdi_data.READ_COLUMNS + f' from vdi_devices d where length(d.short_norm) in ({place(lengths)}) '
                                                 f'and atlas_lookalike(d.short_norm) in ({place(left)}) order by d.name_norm limit 20', (*lengths, *left)):
                written = left.get(lookalike_key(str(record.get('vdi_short_name') or '').casefold()))
                if written in missing:
                    add(citrix(record), written, lookalike=True)
    return rows


# People named in a message, as people write them: "Marie Dupont", "DUPONT Marie", "Dupont, Marie",
# "Marie Dupont's laptop", "Bonjour Marie Dupont". Every two- and three-word window of capitalised
# words is tried in both orders, so only names that exist in the directory come back.
NAME_WORD = r"[A-ZÀ-Þ][A-Za-zÀ-ÿ'’-]*[A-Za-zÀ-ÿ]"
NAME_RUN = re.compile(rf"{NAME_WORD}(?:(?:[ \t]+|,[ \t]*){NAME_WORD})+")
PEOPLE = 8


def name_candidates(text, limit=400):
    """{directory name_norm: name as written}."""
    found = {}
    for run in NAME_RUN.finditer(text):
        words = [re.sub(r"['’]s$", '', word) for word in re.split(r'[ \t]+|,[ \t]*', run.group(0)) if word]
        for size in (3, 2):
            for start in range(len(words) - size + 1):
                window = words[start:start + size]
                written = ' '.join(window)
                variants = [window] if size == 3 else [window, window[::-1]]
                for variant in variants:
                    found.setdefault(' '.join(variant).lower(), written)
                if size == 2:
                    # Directories keep "Dupont, Marie" too; either order may have been written.
                    found.setdefault(f'{window[1]}, {window[0]}'.lower(), written)
                    found.setdefault(f'{window[0]}, {window[1]}'.lower(), written)
        if len(found) >= limit:
            break
    return found


def operator_accounts():
    """The Windows accounts running Atlas (x01426046_dsk is x01426046's admin account)."""
    accounts = set()
    for value in (os.environ.get('USERNAME'), os.environ.get('USER')):
        value = str(value or '').rsplit('\\', 1)[-1].casefold()
        if value:
            accounts |= {value, re.sub(r'[_-](dsk|adm|admin|a)$', '', value)}
    return accounts


def people_desks(connection, people):
    try:
        from desk_directory import people_desks as desks
        return desks(connection, people)
    except (sqlite3.Error, KeyError, ValueError):
        return {}


def mentioned_people(connection, text, exclude=()):
    """People the message names (full name, email address or account ID), in the order they are
    written, with their linked machines. The sender and the Atlas operator are left out. A name
    shared by several people is returned once with its candidates."""
    from clipboard_history import ACCOUNT, EMAIL
    exclude, operators = set(exclude), operator_accounts()
    keep = lambda row: row['id'] not in exclude and str(row['user_name'] or '').casefold() not in operators
    entries = {}

    def add(rows, basis, written):
        # A name that is also the sender's or the operator's (a signature, "Hi <operator>") means them.
        if not rows or not all(keep(row) for row in rows):
            return
        position = text.find(written)
        if len(rows) == 1:
            key, entry = ('user', rows[0]['id']), {**person(rows[0]), 'written': written, 'basis': basis}
        else:
            key, entry = ('name', written.casefold()), {'ambiguous': True, 'written': written, 'basis': basis,
                                                      'candidates': [person(row) for row in rows[:5]]}
        # Listed in the order of their first mention, however they were written.
        if key not in entries or 0 <= position < entries[key][0] or entries[key][0] < 0:
            entries[key] = (position, entry)

    for address in dict.fromkeys(EMAIL.findall(text)):
        add(exact_users(connection, address, field='email'), 'email', address)
    for account in dict.fromkeys(ACCOUNT.findall(text)):
        add(exact_users(connection, account), 'account', account)
    names = name_candidates(text)
    rows = []
    keys = list(names)
    for start in range(0, len(keys), 400):
        chunk = keys[start:start + 400]
        rows += connection.execute(f"SELECT * FROM legacy_users WHERE name_norm IN ({','.join('?' * len(chunk))})", chunk).fetchall()
    by_name = {}
    for row in rows:
        by_name.setdefault(row['name_norm'], []).append(row)
    for key, matches in by_name.items():
        add(matches, 'name', names[key])
    people = [entry for _, entry in sorted(entries.values(), key=lambda item: (item[0] < 0, item[0]))][:PEOPLE]
    for entry in people:
        if not entry.get('ambiguous'):
            entry['machines'] = linked_machines(connection, entry['id'])[:6]
    return people


inbox_states = None


def safely(load, label, warnings):
    # The request can still be read when the package share or knowledge store is unavailable.
    try:
        return list(load())
    except Exception as error:
        warnings.append(f'{label} unavailable: {error}')
        return []


def register(app, directory_connection, get_directory=mail_directory, packages=lambda: [], documents=lambda: [],
             state=None, check_token=None, deployments=lambda names: []):
    from inbox_state import InboxState
    global inbox_states
    if state is None:
        from runtime_paths import inbox_state_path
        state = InboxState(inbox_state_path)
    inbox_states = state  # Test servers point it at their temporary folder.

    def require_token(request):
        if check_token:
            return check_token(request)
        import secrets
        from atlas_api import TOKEN
        if not secrets.compare_digest(request.headers.get('x-atlas-token', ''), TOKEN):
            raise HTTPException(403, 'Refresh Atlas before changing Live Inbox messages.')

    @app.get('/api/inbox/arrivals')
    def arrivals(after_id: int = Query(0, ge=0)):
        # Atlas desktop alerts need counts only, never sender names or bodies.
        with queue_reader(get_directory()) as queue:
            if queue is None:
                return {'newest_id': 0, 'count': 0}
            newest = queue.execute('SELECT coalesce(max(id),0) FROM messages').fetchone()[0]
            count = queue.execute('SELECT count(*) FROM messages WHERE id>?', (after_id,)).fetchone()[0]
            return {'newest_id': newest, 'count': count}

    @app.get('/api/inbox/messages')
    def messages(after_id: int = Query(0, ge=0), before_id: int = Query(0, ge=0),
                 limit: int = Query(50, ge=1, le=100)):
        if after_id and before_id:
            raise HTTPException(400, 'Use either newer or older pagination, not both.')
        directory = get_directory()
        with queue_reader(directory) as queue:
            rows, total, newest = [], 0, 0
            if queue is not None:
                total, newest = queue.execute('SELECT count(*),coalesce(max(id),0) FROM messages').fetchone()
                where = 'WHERE id>?' if after_id else 'WHERE id<?' if before_id else ''
                parameters = [after_id or before_id] if where else []
                order = 'ASC' if after_id else 'DESC'
                rows = queue.execute('SELECT id,source,entry_id,received_at,imported_at,sender_name,sender_address,subject,'
                                     + source_columns(queue) + ' '
                                     f'FROM messages {where} ORDER BY id {order} LIMIT ?',
                                     (*parameters, limit + 1)).fetchall()
        more = len(rows) > limit
        done = state.done_keys()
        from inbox_state import key as state_key
        items = []
        for row in rows[:limit]:
            item = dict(row)
            item['done'] = state_key(item.pop('source'), item.pop('entry_id')) in done
            items.append(item)
        if items:
            try:
                with directory_connection() as connection:
                    for item in items:
                        item['match'] = match_sender(connection, item)
            except sqlite3.Error as error:
                raise HTTPException(503, 'Atlas directory lookup is unavailable. Retry after the database is ready.') from error
        return {'items': items, 'total': total, 'newest_id': newest, 'has_more': more,
                'next_before': items[-1]['id'] if items and not after_id else None,
                'next_after': items[-1]['id'] if items and after_id else newest,
                'watcher': watcher_status(directory), 'notifications': notifications_status(directory)}

    @app.get('/api/inbox/messages/{message_id}')
    def message(message_id: int, user_id: int | None = Query(None, ge=1)):
        with queue_reader(get_directory()) as queue:
            row = queue.execute('SELECT * FROM messages WHERE id=?', (message_id,)).fetchone() if queue else None
        if row is None:
            raise HTTPException(404, 'Message not found in the local inbox.')
        item = dict(row)
        for key, default in (('channel', 'outlook'), ('content_kind', 'mail'), ('app_name', '')):
            item.setdefault(key, default)
        item['state'] = state.get(item.get('source', ''), item.get('entry_id', '')) or {'done': False}
        item['outlook'] = item['content_kind'] == 'mail' and outlook_actions(get_directory())
        # Outlook entry/store IDs are private implementation details, not browser links.
        for key in ('source', 'entry_id', 'conversation_id'):
            item.pop(key, None)
        from inbox_analysis import analyse
        warnings = []
        catalogue, knowledge = safely(packages, 'Package catalogue', warnings), safely(documents, 'Knowledge Base', warnings)
        try:
            with directory_connection() as connection:
                match = match_sender(connection, item, user_id)
                machines = linked_machines(connection, match['user']['id']) if match['user'] else []
                analysis = analyse(item.get('subject'), item.get('body'), packages=catalogue, documents=knowledge,
                                   find_machines=lambda names: mentioned_machines(connection, names),
                                   linked=[m.get('name') for m in machines])
                from inbox_analysis import latest_text
                sender = [match['user']['id']] if match['user'] else []
                analysis['people'] = mentioned_people(connection, latest_text(item.get('subject'), item.get('body')), sender)
                # Where the sender and the people named sit, from the floor plan.
                known = [user for user in [match['user'], *analysis['people']] if user and not user.get('ambiguous')]
                desks = people_desks(connection, known)
                for user in known:
                    user['desks'] = desks.get(user['canonical_key'], [])
        except sqlite3.Error as error:
            raise HTTPException(503, 'Atlas directory lookup is unavailable. Retry after the database is ready.') from error
        return {'message': item, 'match': match, 'machines': machines, 'analysis': {**analysis, 'warnings': warnings}}

    @app.post('/api/inbox/messages/{message_id}/done')
    def mark_done(message_id: int, request: Request, body: dict = Body(...)):
        """Done (or open again) in Live Inbox; Outlook is told too when the Companion supplied the email."""
        require_token(request)
        done = body.get('done')
        if type(done) is not bool:
            raise HTTPException(422, 'Send {"done": true} or {"done": false}.')
        directory = get_directory()
        with queue_reader(directory) as queue:
            row = queue.execute('SELECT * FROM messages WHERE id=?', (message_id,)).fetchone() if queue else None
        if row is None:
            raise HTTPException(404, 'Message not found in the local inbox.')
        row = {'content_kind': 'mail', **dict(row)}  # Queues from before notification previews have no content_kind.
        saved = state.set(row['source'], row['entry_id'], done, by=request.headers.get('x-atlas-operator', ''))
        outlook = False
        if row['content_kind'] == 'mail' and outlook_actions(directory):
            import companion_server
            try:
                companion_server.companion.send('outlook.done', {'message_id': message_id, 'done': done})
                outlook = True
            except HTTPException:
                pass  # Live Inbox keeps the state; Outlook is updated next time it can be.
        return {'id': message_id, 'done': done, 'state': saved or {'done': False}, 'outlook': outlook}

    @app.get('/api/inbox/person/{user_id}')
    def person_detail(user_id: int):
        """A person's directory record, linked machines and desk for the Live Inbox request tools."""
        try:
            with directory_connection() as connection:
                row = connection.execute('SELECT * FROM legacy_users WHERE id=?', (user_id,)).fetchone()
                if row is None:
                    raise HTTPException(404, 'This person is no longer in the Atlas directory.')
                user = dict(row)
                machines = linked_machines(connection, user_id)
                result = {'user': user, 'machines': machines, 'desks': people_desks(connection, [person(row)]).get(user['canonical_key'], [])}
        except sqlite3.Error as error:
            raise HTTPException(503, 'Atlas directory lookup is unavailable. Retry after the database is ready.') from error
        # What came before: their earlier requests in Live Inbox and the latest deployments to their PCs.
        result['requests'] = []
        address = str(user.get('email') or '').strip().lower()
        if address:
            try:
                with queue_reader(get_directory()) as queue:
                    if queue is not None:
                        result['requests'] = [dict(r) for r in queue.execute(
                            'SELECT id,received_at,subject FROM messages WHERE lower(sender_address)=? ORDER BY id DESC LIMIT 6', (address,))]
            except HTTPException:
                pass
        try:
            result['deployments'] = list(deployments([m.get('name') or m.get('machine_name') for m in machines]))
        except Exception:
            result['deployments'] = []
        return result
