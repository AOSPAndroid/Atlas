"""Optional asset fields and conservative device classification for directory records."""
import hashlib
import re

ASSET_COLUMNS = ('asset_tag', 'model_category', 'last_used', 'install_status',
                 'assigned_at', 'display_name', 'device_location', 'source_ci')
NON_WINDOWS_KINDS = frozenset(('iphone', 'phone', 'tablet', 'mac'))


def inventory_identity(record, row_number):
    """Keep real PC hostnames; identify mobile assets without using generic CI labels."""
    source = str(record.get('machine_name') or '').strip()
    kind = device_kind(source, record.get('model_category'), record.get('model_id'),
                       record.get('sys_class_name'))
    if kind not in NON_WINDOWS_KINDS:
        return source.upper(), 'hostname' if source else ''
    for column, namespace in (('sys_id', 'CMDB-'), ('serial_number', 'SERIAL-'), ('asset_tag', 'ASSET-')):
        value = str(record.get(column) or '').strip().upper()
        if value and value.casefold() not in ('0', 'unknown', 'none', 'n/a', 'na', '(empty)', 'not supplied'):
            token = value if re.fullmatch(r'[A-Z0-9][A-Z0-9_.-]{0,39}', value) else hashlib.sha256(value.encode()).hexdigest()[:24].upper()
            return f'{kind.upper()}-{namespace}{token}', column
    # A meaningful CI is useful when the export has no hardware identifier.
    generic = {'iphone', 'ipad', 'phone', 'tablet', 'mac', 'mobile device', 'mobile device - handheld', 'unknown', 'none', 'n/a', '(empty)'}
    if source and source.casefold() not in generic:
        token=source.upper()
        if not re.fullmatch(r'[A-Z0-9][A-Z0-9_.-]{0,39}',token):token=hashlib.sha256(token.encode()).hexdigest()[:24].upper()
        return f'{kind.upper()}-CI-{token}', 'ci'
    # Without an identifier, preserve each source row rather than merging unrelated phones.
    return f'{kind.upper()}-ROW-{row_number}', 'row'


def ensure_asset_columns(con):
    """Called inside a writable refresh transaction; old backups remain compatible."""
    known = {r[1] for r in con.execute('pragma table_info(machines)')}
    for column in ASSET_COLUMNS:
        if column not in known:
            con.execute(f"alter table machines add column {column} text not null default ''")
    con.execute('create index if not exists ix_machines_asset_lower on machines(lower(asset_tag))')
    con.execute('create index if not exists ix_machines_source_ci_lower on machines(lower(source_ci))')


def device_kind(name='', category='', model='', record_class=''):
    text = ' '.join(str(v or '') for v in (category, model, record_class)).lower()
    hostname = str(name or '').strip().upper().split('.')[0]
    if 'iphone' in text or hostname=='IPHONE' or hostname.startswith('IPHONE-'): return 'iphone'
    if re.search(r'\b(ipad|tablet)\b', text) or hostname in ('IPAD','TABLET') or hostname.startswith(('IPAD-','TABLET-')): return 'tablet'
    if re.search(r'mobile device|handheld|android|\b(phone|smartphone)\b', text) or hostname=='PHONE' or hostname.startswith('PHONE-'): return 'phone'
    if re.search(r'\b(macbook|imac|mac mini|mac pro)\b', text): return 'mac'
    if re.search(r'\b(laptop|notebook|latitude|thinkpad|elitebook|zbook|probook)\b', text): return 'laptop'
    if re.match(r'^[A-Z]{3}PWMK', hostname): return 'kiosk'
    if 'VDI' in hostname: return 'vdi'
    if re.match(r'^[A-Z]{3}PWMF', hostname): return 'desktop'
    if re.search(r'\b(computer|desktop|workstation)\b', text): return 'desktop'
    return 'other'


def supports_windows(record):
    return device_kind(record.get('machine_name', record.get('name', '')),
                       record.get('model_category', ''), record.get('model_id', ''),
                       record.get('sys_class_name', '')) not in NON_WINDOWS_KINDS
