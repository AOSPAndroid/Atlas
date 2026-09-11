"""Export field definitions, lossless cell storage and read-only inspection.

Raw rows are separate from operational tables. Adding an export column never
changes the identity/assignment schema or enables an administrative operation.
"""
import json

USER_FIELDS = (
    ('user_name', 'user_id', 'Account'), ('name', 'full_name', 'Name'),
    ('email', 'email', 'Email'),
    ('u_organisational_unit', 'organisational_unit', 'Organisation'),
    ('u_business_unit', 'business_unit', 'Business unit'),
    ('u_start_date', 'start_date', 'Start date'), ('manager', 'manager', 'Manager'),
    ('location', 'location', 'Office'), ('last_login', 'last_login', 'Last login date'),
    ('last_login_time', 'last_login_time', 'Last login time'),
    ('title', 'job_role', 'Job title'), ('u_job_type', 'job_type', 'Worker type'),
    ('employee_number', 'employee_number', 'Employee ID'), ('department', 'department', 'Department'),
)
MACHINE_FIELDS = (
    ('name', 'machine_name', 'Hostname'),
    ('u_infrastructure_itsi', 'infrastructure_itsi', 'Infrastructure'),
    ('sys_class_name', 'sys_class_name', 'Record class'),
    ('operational_status', 'operational_status', 'Inventory status'),
    ('u_barclays_correlation_id', 'correlation_id', 'Correlation ID'),
    ('serial_number', 'serial_number', 'Serial number'),
    ('manufacturer', 'manufacturer', 'Manufacturer'), ('model_id', 'model_id', 'Model'),
    ('short_description', 'short_description', 'Description'),
    ('sys_updated_on', 'updated_on', 'Record updated'),
    ('last_discovered', 'last_discovered', 'Last discovered'),
    ('discovery_source', 'discovery_source', 'Discovery source'),
    ('assigned_to', 'assigned_to', 'Assigned to'),
    ('u_last_logon_user', 'last_logon_user', 'Last logged-on user'),
)
FIELDS = {'user': USER_FIELDS, 'machine': MACHINE_FIELDS}
TABLES = ('directory_export_sheets', 'directory_export_rows')


def field_map(kind):
    return {alias: (column, label) for source, column, label in FIELDS.get(kind, ())
            for alias in (source, column)}


def exists(con):
    return con.execute("select 1 from sqlite_master where name='directory_export_sheets' and type='table'").fetchone() is not None


def schema(con):
    # Individual statements preserve the caller's transaction (no executescript).
    con.execute('create table if not exists directory_export_sheets(sheet text primary key,kind text not null,source_file text not null,headers text not null,populated text not null,row_count integer not null,linked_count integer not null)')
    con.execute('create table if not exists directory_export_rows(sheet text not null,row_number integer not null,entity_key text not null,cells text not null,primary key(sheet,row_number))')
    con.execute('create index if not exists ix_export_entity on directory_export_rows(entity_key,sheet)')


def copy_archive(source, target):
    schema(target)
    for table in reversed(TABLES):
        target.execute('delete from '+table)
    if exists(source):
        for table, count in ((TABLES[0], 7), (TABLES[1], 4)):
            target.executemany('insert into '+table+' values ('+','.join('?' for _ in range(count))+')',
                               (tuple(row) for row in source.execute('select * from '+table)))


def capture(con, path):
    from directory_workbook import workbook_parts, iter_rows, canonical_header, clean, norm
    schema(con)
    for sheet, part in workbook_parts(path):
        kind = {'users': 'user', 'computers': 'machine'}.get(sheet.casefold(), '')
        rows = iter_rows(path, part, raw=True)
        first = next(rows, None)
        if first is None:
            con.execute('insert into directory_export_sheets values(?,?,?,?,?,?,?)',
                        (sheet, kind, path.name, '[]', '[]', 0, 0))
            continue
        _, headers = first
        mapped = [field_map(kind).get(canonical_header(h), ('', ''))[0] for h in headers]
        populated = [0] * len(headers)
        row_count = linked_count = 0
        for number, row in rows:
            if not any(value != '' for value in row):
                continue
            if len(row) > len(headers):
                headers.extend('' for _ in range(len(row)-len(headers)))
                populated.extend(0 for _ in range(len(headers)-len(populated)))
            cells = list(row)  # Positional arrays preserve duplicate/blank headers.
            d = {column: clean(row[i]) if i < len(row) else '' for i, column in enumerate(mapped) if column}
            key = ''
            if kind == 'user':
                key = next((prefix+norm(d.get(column)) for prefix, column in
                            (('uid:', 'user_id'), ('email:', 'email'), ('name:', 'full_name')) if d.get(column)), '')
            elif kind == 'machine' and d.get('machine_name'):
                key = 'machine:'+norm(d['machine_name'])
            con.execute('insert into directory_export_rows values(?,?,?,?)',
                        (sheet, number, key, json.dumps(cells, ensure_ascii=False, separators=(',', ':'))))
            row_count += 1
            linked_count += bool(key)
            for i, value in enumerate(cells):
                populated[i] += value != ''
        con.execute('insert into directory_export_sheets values(?,?,?,?,?,?,?)',
                    (sheet, kind, path.name, json.dumps(headers, ensure_ascii=False),
                     json.dumps(populated), row_count, linked_count))


def column_info(kind, headers, populated):
    from directory_workbook import canonical_header
    mapping = field_map(kind)
    result = []
    for i, header in enumerate(headers):
        field, label = mapping.get(canonical_header(header), ('', ''))
        result.append({'column': i+1, 'header': header or f'Column {i+1}',
                       'field': field, 'label': label or header or f'Column {i+1}',
                       'populated': populated[i],
                       'use': 'Profile, search and export details' if field else 'Retained in export archive (admin)'})
    return result


def coverage(con):
    if exists(con) and con.execute('select 1 from directory_export_sheets limit 1').fetchone():
        sheets = []
        for sheet, kind, source, headers, populated, rows, linked in con.execute('select * from directory_export_sheets order by sheet'):
            sheets.append({'sheet': sheet, 'source': source, 'rows': rows, 'linked': linked,
                           'columns': column_info(kind, json.loads(headers), json.loads(populated))})
        return {'original_cells': True, 'sheets': sheets}
    sheets = []
    for kind, table, name in (('user', 'users', 'Users'), ('machine', 'machines', 'computers')):
        fields = FIELDS[kind]
        query = ','.join('sum(case when trim(coalesce("'+column+'",\'\'))<>\'\' then 1 else 0 end)' for _, column, _ in fields)
        row = con.execute('select count(*),'+query+' from '+table).fetchone()
        sheets.append({'sheet': name, 'source': 'Stored directory', 'rows': row[0], 'linked': row[0],
                       'columns': column_info(kind, [f[0] for f in fields], [v or 0 for v in row[1:]])})
    return {'original_cells': False, 'sheets': sheets}


def record(con, kind, key, *, include_unmapped=True):
    # A refresh must not mix a person from one snapshot with another's cells.
    con.execute('savepoint directory_record_read')
    try:
        return _record(con, kind, key, include_unmapped=include_unmapped)
    finally:
        con.execute('release directory_record_read')


def _record(con, kind, key, *, include_unmapped):
    if kind not in FIELDS:
        raise ValueError('Choose a person or machine')
    table, identity = ('users', 'canonical_key') if kind == 'user' else ('machines', 'machine_name_norm')
    row = con.execute('select * from '+table+' where '+identity+'=?', (key,)).fetchone()
    if row is None:
        return None
    data = dict(row)
    name = data['full_name' if kind == 'user' else 'machine_name']
    if exists(con):
        archived = con.execute('select s.sheet,s.source_file,s.headers,r.row_number,r.cells from directory_export_rows r join directory_export_sheets s on s.sheet=r.sheet where r.entity_key=? and s.kind=? order by r.row_number limit 1',
                               (key if kind == 'user' else 'machine:'+key, kind)).fetchone()
        if archived:
            sheet, source, headers, number, cells = archived
            headers, cells = json.loads(headers), json.loads(cells)
            fields = column_info(kind, headers, [0]*len(headers))
            for i, field in enumerate(fields):
                field['value'] = cells[i] if i < len(cells) else ''
                field['stored_value'] = data.get(field['field']) if field['field'] else None
            visible = [field for field in fields if include_unmapped or field['field']]
            return {'name': name, 'source': source, 'sheet': sheet, 'row': number,
                    'original_cells': True, 'fields': visible, 'restricted_columns': len(fields)-len(visible)}
    return {'name': name, 'source': 'Stored directory', 'original_cells': False,
            'fields': [{'header': source, 'label': label, 'field': column, 'value': data[column]}
                       for source, column, label in FIELDS[kind]], 'restricted_columns': 0}
