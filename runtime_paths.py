"""Source assets and mutable runtime data have separate lifetimes."""
import os
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def database_path():
    configured = os.environ.get('ATLAS_DB_PATH')
    if configured:
        return Path(configured).expanduser().resolve()
    runtime = ROOT / 'data' / 'office_atlas.db'
    return runtime if runtime.exists() else ROOT / 'office_atlas.db'


def prepare_runtime_database():
    """Copy the distributed seed once, using SQLite backup (including WAL data)."""
    if os.environ.get('ATLAS_DB_PATH'):
        path = database_path()
        if not path.is_file():
            raise ValueError('ATLAS_DB_PATH must point to an existing Atlas database.')
        return path
    target = ROOT / 'data' / 'office_atlas.db'
    if target.exists():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    seed = ROOT / 'office_atlas.db'
    temporary = target.with_suffix('.migrating')
    try:
        source = sqlite3.connect(seed.resolve().as_uri() + '?mode=ro', uri=True)
        destination = sqlite3.connect(temporary)
        try:
            source.backup(destination)
            if destination.execute('pragma integrity_check').fetchone()[0] != 'ok':
                raise ValueError('Runtime database copy failed integrity verification.')
        finally:
            source.close()
            destination.close()
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return target
