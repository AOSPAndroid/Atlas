"""Fictional package metadata and disposable databases; no package execution."""
import csv
import gzip
import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlite_fixture import connect as fixture_connect
import package_data as data
import package_data_api as api

HEADERS = ['u_display_name', 'name', 'u_barclays_correlation_id', 'u_package_sub_state', 'u_requester', 'assigned_to', 'u_domain', 'u_build', 'sys_created_on', 'custom_note']


def extract(rows, encoding='utf-8-sig', delimiter=','):
    text = io.StringIO(newline='')
    writer = csv.writer(text, delimiter=delimiter); writer.writerow(HEADERS)
    for short, state in rows:
        writer.writerow(['Example ' + short.strip(), short, 'EPP123', state, 'Zoë Requester', 'Example Packager', 'Client, Intranet', 'Windows 11, Server 2022', '03/10/2026 09:32', 'Additional value'])
    return text.getvalue().encode(encoding)


def seed(con, rows, source='old.csv'):
    parsed, _ = data.parse_csv(extract(rows))
    columns = ['name_key', *data.FIELDS, 'raw_json', 'source', 'imported_at']
    for row in parsed.values():
        row = {**row, 'source': source, 'imported_at': '2026-10-02'}
        con.execute(f"insert into package_data({','.join(columns)}) values({','.join('?' for _ in columns)})", tuple(row[c] for c in columns))
    con.commit()


class PackageParsing(unittest.TestCase):
    def test_photographed_headers_original_cells_and_excel_encodings(self):
        for encoding, delimiter in [('utf-8-sig', ','), ('utf-16', '\t'), ('cp1252', ';')]:
            with self.subTest(encoding=encoding):
                rows, report = data.parse_csv(extract([(' ixExample123 ', 'Work in Progress')], encoding, delimiter))
                row = rows['ixexample123']
                self.assertEqual(row['short_name'], 'ixExample123')
                self.assertEqual(row['requester'], 'Zoë Requester')
                self.assertEqual(row['domain'], 'Client, Intranet')
                self.assertEqual(row['build'], 'Windows 11, Server 2022')
                self.assertEqual(row['created'], '03/10/2026 09:32')
                self.assertEqual(json.loads(row['raw_json'])['custom_note'], 'Additional value')
                self.assertEqual(report['extra_columns'], ['custom_note'])

    def test_display_headers_and_no_guessed_state(self):
        rows, _ = data.parse_csv(b'Display Name,Short Package Name,Package State,Packager (Assigned to)\nExample,ixExample,,Operator\n')
        self.assertEqual(rows['ixexample']['state'], '')
        self.assertEqual(rows['ixexample']['packager'], 'Operator')

    def test_identical_duplicates_collapse_conflicts_block(self):
        text = extract([('ixExample', 'Live'), ('ixExample', 'Live')])
        rows, report = data.parse_csv(text)
        self.assertEqual(len(rows), 1); self.assertEqual(report['duplicates'], 1)
        with self.assertRaisesRegex(ValueError, 'Conflicting duplicate'):
            data.parse_csv(extract([('ixExample', 'Live'), ('IXEXAMPLE', 'Work in Progress')]))
        with self.assertRaisesRegex(ValueError, 'Conflicting duplicate'):
            data.parse_csv(text.replace(b'Additional value\r\n', b'Different value\r\n', 1))

    def test_invalid_headers_rows_paths_and_empty_uploads(self):
        bad = [b'', b'name,state\n', b'display_name,state\nA,Live\n', b'name,name,state\nA,A,Live\n',
               b'name,state\nA,Live,extra\n', b'name,state\n../A,Live\n', b'name,state\n,Live\n',
               b'name,state\nA,"unterminated\n', b'name,state\nA\x00,Live\n']
        for text in bad:
            with self.subTest(text=text), self.assertRaises(ValueError): data.parse_csv(text)

    def test_bounded_upload_and_row_count(self):
        with self.assertRaisesRegex(ValueError, '10 MB'): data.parse_csv(b'x' * (10 * 1024 * 1024 + 1))
        with self.assertRaisesRegex(ValueError, '20,000'): data.parse_csv(('name,state\n' + ''.join(f'p{i},Live\n' for i in range(20001))).encode())


class PackageBrowsing(unittest.TestCase):
    def test_exact_name_union_filters_ambiguity_and_missing_metadata(self):
        with tempfile.TemporaryDirectory() as temp, fixture_connect(':memory:') as con:
            repo = Path(temp)
            for name in ['ixExample', 'ixExample-extra', 'ixOther', 'ixCOLLISION', 'ixcollision']:
                (repo / name).mkdir()
            data.initialize(con); seed(con, [('ixexample', 'Live'), ('ixBuilding', 'Work in Progress'), ('ixcollision', 'Live')])
            result = data.browse(con, repo)
            self.assertEqual(result['stats'], {'source_packages': 5, 'metadata_packages': 3, 'matched': 1, 'source_only': 2, 'metadata_only': 2, 'ambiguous': 2})
            items = {item['id']: item for item in result['items']}
            self.assertEqual(items['repo:ixExample']['state'], 'Live')
            self.assertEqual(items['repo:ixExample-extra']['state'], '')
            self.assertFalse(items['data:ixbuilding']['source_present'])
            self.assertFalse(items['repo:ixcollision']['metadata_present'])
            self.assertNotIn('raw_json', items['repo:ixExample'])
            self.assertEqual(data.browse(con, repo, state='Work in Progress')['total'], 1)
            self.assertEqual(data.browse(con, repo, term='EPP123', coverage='matched')['total'], 1)
            self.assertEqual(data.browse(con, repo, coverage='source-only')['total'], 2)
            (repo / 'ixLink').symlink_to(repo / 'ixExample', target_is_directory=True)
            self.assertEqual(data.browse(con, repo)['stats']['source_packages'], 5)

    def test_eight_thousand_source_packages_two_thousand_records_all_accessible(self):
        with fixture_connect(':memory:') as con:
            data.initialize(con)
            seed(con, [(f'ixPackage{i:05}', 'Live' if i % 2 else 'Work in Progress') for i in range(2000)])
            names = [f'ixPackage{i:05}' for i in range(8000)]
            seen = set()
            with patch.object(data, 'repository_names', return_value=(names, True, '')):
                for offset in range(0, 8000, 200):
                    result = data.browse(con, offset=offset, limit=200)
                    self.assertEqual(result['total'], 8000)
                    self.assertEqual(result['stats']['matched'], 2000)
                    self.assertEqual(result['stats']['source_only'], 6000)
                    seen.update(item['id'] for item in result['items'])
            self.assertEqual(len(seen), 8000)

    def test_readonly_old_database_and_unavailable_source(self):
        with fixture_connect(':memory:') as con:
            con.execute('pragma query_only=on')
            self.assertEqual(data.browse(con)['total'], 0)
            self.assertFalse(con.execute("select 1 from sqlite_master where name='package_data'").fetchone())
        with fixture_connect(':memory:') as con:
            data.initialize(con); seed(con, [('ixExample', 'Live')])
            result = data.browse(con, Path('/nonexistent-package-fixture'))
            self.assertFalse(result['source_available']); self.assertEqual(result['total'], 1)
            self.assertEqual(result['items'][0]['coverage'], 'metadata-only')


class PackageImport(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.db = self.root / 'fixture.db'; self.repo = self.root / 'repo'; self.repo.mkdir()
        (self.repo / 'ixExample').mkdir(); (self.repo / 'ixExample' / 'setup_i.ps1').write_text('exit 0')
        with fixture_connect(self.db) as con:
            con.execute('create table users(id integer, name text)'); con.execute("insert into users values(1,'Stored Person')")
            con.execute('create table package_catalog(repository text,folder text,display_name text,version text,revision integer)')
            con.execute('insert into package_catalog values(?,?,?,?,?)', (str(self.repo), 'ixExample', 'Custom display', 'v1', 2))
        app = FastAPI()
        def check(request):
            if request.headers.get('x-atlas-token') != 'test': raise HTTPException(403, 'token')
        self.patch = patch.object(api, '__file__', str(self.root / 'package_data_api.py')); self.patch.start()
        api.register(app, SimpleNamespace(MASTER_DB=self.db, REPO=self.repo), check)
        self.client = TestClient(app); self.headers = {'x-atlas-token': 'test', 'x-file-name': 'packages.csv'}

    def tearDown(self):
        self.client.close(); self.patch.stop(); self.temp.cleanup()

    def preview(self, rows):
        response = self.client.post('/api/package-data/import/preview', content=extract(rows), headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def apply(self, preview):
        return self.client.post('/api/package-data/import/apply/' + preview['id'], headers=self.headers)

    def test_preview_apply_merge_backup_and_no_directory_or_source_mutation(self):
        first = self.preview([('ixExample', 'Live'), ('ixPending', 'Work in Progress')])
        self.assertEqual(first['report']['matched'], 1); self.assertEqual(first['report']['metadata_only'], 1)
        self.assertEqual(self.client.get('/api/package-data').json()['stats']['metadata_packages'], 0)
        saved = self.apply(first); self.assertEqual(saved.status_code, 200, saved.text)
        with gzip.open(self.root / 'backups' / saved.json()['backup'], 'rt') as backup:
            self.assertEqual(json.load(backup)['packages'], [])
        second = self.preview([('ixExample', 'Work in Progress')]); self.assertEqual(second['report']['retained'], 1)
        saved = self.apply(second); self.assertEqual(saved.status_code, 200, saved.text)
        with gzip.open(self.root / 'backups' / saved.json()['backup'], 'rt') as backup:
            self.assertEqual(len(json.load(backup)['packages']), 2)
        result = self.client.get('/api/package-data').json()
        self.assertEqual(result['stats']['metadata_packages'], 2)
        example = next(item for item in result['items'] if item['short_name'] == 'ixExample')
        self.assertEqual(example['display_name'], 'Custom display'); self.assertEqual(example['state'], 'Work in Progress')
        self.assertEqual(example['version'], 'v1')
        with fixture_connect(self.db) as con:
            self.assertEqual(con.execute('select name from users').fetchone()[0], 'Stored Person')
            self.assertEqual(con.execute('select revision from package_catalog').fetchone()[0], 2)
            self.assertEqual(con.execute('pragma integrity_check').fetchone()[0], 'ok')
        self.assertEqual((self.repo / 'ixExample' / 'setup_i.ps1').read_text(), 'exit 0')
        self.assertEqual(self.apply(second).status_code, 409)
        status = self.client.get('/api/package-data/import/status').json()
        self.assertEqual(status['count'], 2); self.assertEqual(status['last_import']['source'], 'packages.csv')

    def test_tokens_validation_pagination_expiry_cancel_and_revision_conflicts(self):
        self.assertEqual(self.client.post('/api/package-data/import/preview', content=extract([('ixExample','Live')])).status_code, 403)
        first = self.preview([('ixExample', 'Live')]); second = self.preview([('ixOther', 'Live')])
        self.assertEqual(self.apply(first).status_code, 409)
        with fixture_connect(self.db) as con: seed(con, [('ixExternal', 'Live')])
        self.assertEqual(self.apply(second).status_code, 409)
        third = self.preview([('ixOther', 'Live')])
        self.assertEqual(self.client.delete('/api/package-data/import/preview/'+third['id'], headers=self.headers).status_code, 200)
        self.assertEqual(self.apply(third).status_code, 409)
        fourth = self.preview([('ixOther', 'Live')])
        with patch.object(api.time, 'time', return_value=api.time.time() + 3601): self.assertEqual(self.apply(fourth).status_code, 409)
        for query in ['limit=1000', 'offset=-1', 'coverage=invalid']:
            self.assertEqual(self.client.get('/api/package-data?' + query).status_code, 422)
        self.assertEqual(self.client.post('/api/package-data/import/preview', content=b'name,state\nA,Live,extra\n', headers=self.headers).status_code, 400)

    def test_failed_commit_rolls_back_all_rows_and_preserves_preview(self):
        preview = self.preview([('ixFirst', 'Live'), ('ixFail', 'Live')])
        with fixture_connect(self.db) as con:
            con.execute("create trigger reject_test before insert on package_data when NEW.short_name='ixFail' begin select raise(ABORT,'fixture constraint'); end")
        with self.assertRaises(sqlite3.IntegrityError): self.apply(preview)
        with fixture_connect(self.db) as con:
            self.assertEqual(con.execute('select count(*) from package_data').fetchone()[0], 0)
            self.assertEqual(con.execute('select count(*) from package_data_imports').fetchone()[0], 0)
            con.execute('drop trigger reject_test')
        self.assertEqual(list((self.root / 'backups').iterdir()), [])
        self.assertEqual(self.apply(preview).status_code, 200)

    def test_demo_reads_metadata_but_cannot_import_or_scan_share(self):
        from backend import viewer
        self.apply(self.preview([('ixExample', 'Live')]))
        # The fixture lacks directory schema; use an explicit read-only connection.
        from contextlib import contextmanager
        @contextmanager
        def connect():
            con = fixture_connect(self.db.resolve().as_uri() + '?mode=ro', uri=True)
            con.execute('pragma query_only=on')
            try: yield con
            finally: con.close()
        with patch.object(viewer, 'connect', connect), patch.object(data.os, 'scandir', side_effect=AssertionError('Demo must not enumerate package source')):
            with TestClient(viewer.app) as client:
                self.assertEqual(client.get('/api/package-data').json()['total'], 1)
                self.assertEqual(client.post('/api/package-data/import/preview').status_code, 403)
                self.assertEqual(client.post('/api/package-data/import/apply/test').status_code, 403)


if __name__ == '__main__': unittest.main()
