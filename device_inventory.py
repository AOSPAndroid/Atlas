"""Optional asset fields and conservative device classification for directory records."""
import re

ASSET_COLUMNS = ('asset_tag', 'model_category', 'last_used', 'install_status',
                 'assigned_at', 'display_name', 'device_location')
NON_WINDOWS_KINDS = frozenset(('iphone', 'phone', 'tablet', 'mac'))


def ensure_asset_columns(con):
    """Called inside a writable refresh transaction; old backups remain compatible."""
    known = {r[1] for r in con.execute('pragma table_info(machines)')}
    for column in ASSET_COLUMNS:
        if column not in known:
            con.execute(f"alter table machines add column {column} text not null default ''")
    con.execute('create index if not exists ix_machines_asset_lower on machines(lower(asset_tag))')


def device_kind(name='', category='', model='', record_class=''):
    text = ' '.join(str(v or '') for v in (category, model, record_class)).lower()
    hostname = str(name or '').strip().upper().split('.')[0]
    if 'iphone' in text or hostname.startswith('IPHONE-'): return 'iphone'
    if re.search(r'\b(ipad|tablet)\b', text) or hostname.startswith('IPAD-'): return 'tablet'
    if re.search(r'mobile device|handheld|android|\b(phone|smartphone)\b', text): return 'phone'
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
