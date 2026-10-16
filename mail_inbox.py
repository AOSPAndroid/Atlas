"""Local Admin inbox reads and directory joins. Never registered on the LAN viewer."""
from contextlib import contextmanager
from datetime import datetime
import os
from pathlib import Path
import sqlite3

from fastapi import HTTPException, Query
from directory_lookup import exact_users, linked_machines
from outlook_watcher import default_directory, status, utcnow
from notification_inbox import notification_status, source_columns


def mail_directory():
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
    if not names:
        return []
    columns = 'name,name_norm,device_kind,model_id,operational_status,windows_remote_supported'
    rows = [dict(row) for row in connection.execute(
        f'SELECT {columns} FROM legacy_machines WHERE name_norm IN (%s) ORDER BY name' % ','.join('?' * len(names)), names)]
    found = {row['name_norm'] for row in rows}
    # Names with no exact match are retried with look-alike characters made equal, so a misread
    # "GBRPWMK2O88I521" still finds GBRPWMK20881521. Only machines in inventory are returned.
    missing = {lookalike_key(name): name for name in names if name not in found}
    if missing:
        connection.create_function('atlas_lookalike', 1, lookalike_key, deterministic=True)
        lengths = sorted({len(name) for name in missing.values()})
        for row in connection.execute(
                f'SELECT {columns} FROM legacy_machines WHERE length(name_norm) IN (%s) AND atlas_lookalike(name_norm) IN (%s) '
                'ORDER BY name LIMIT 20' % (','.join('?' * len(lengths)), ','.join('?' * len(missing))),
                (*lengths, *missing)):
            if row['name_norm'] not in found:
                found.add(row['name_norm'])
                rows.append({**dict(row), 'written_as': missing[lookalike_key(row['name_norm'])].upper()})
    return [{key: value for key, value in row.items() if key != 'name_norm'} for row in rows]


def safely(load, label, warnings):
    # The request can still be read when the package share or knowledge store is unavailable.
    try:
        return list(load())
    except Exception as error:
        warnings.append(f'{label} unavailable: {error}')
        return []


def register(app, directory_connection, get_directory=mail_directory, packages=lambda: [], documents=lambda: []):
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
                rows = queue.execute('SELECT id,received_at,imported_at,sender_name,sender_address,subject,'
                                     + source_columns(queue) + ' '
                                     f'FROM messages {where} ORDER BY id {order} LIMIT ?',
                                     (*parameters, limit + 1)).fetchall()
        more = len(rows) > limit
        items = [dict(row) for row in rows[:limit]]
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
                'watcher': watcher_status(directory), 'notifications': notification_status(directory)}

    @app.get('/api/inbox/messages/{message_id}')
    def message(message_id: int, user_id: int | None = Query(None, ge=1)):
        with queue_reader(get_directory()) as queue:
            row = queue.execute('SELECT * FROM messages WHERE id=?', (message_id,)).fetchone() if queue else None
        if row is None:
            raise HTTPException(404, 'Message not found in the local inbox.')
        item = dict(row)
        for key, default in (('channel', 'outlook'), ('content_kind', 'mail'), ('app_name', '')):
            item.setdefault(key, default)
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
        except sqlite3.Error as error:
            raise HTTPException(503, 'Atlas directory lookup is unavailable. Retry after the database is ready.') from error
        return {'message': item, 'match': match, 'machines': machines, 'analysis': {**analysis, 'warnings': warnings}}
