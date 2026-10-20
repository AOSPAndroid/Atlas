"""Live floor plan against a copy of the Atlas database; plans are synthetic workbooks."""
from sqlite_fixture import isolate_backend_database
isolate_backend_database()
import json
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from atlas_store import ClosingConnection

from desk_moves import snapshot
from seating_sync import SeatingSync, Settings, large, seating_version
from sqlite_fixture import connect as fixture_connect
from test_directory_exports import workbook

SEED = Path(__file__).resolve().parents[1] / 'office_atlas.db'


def official(db, desk):
    with sqlite3.connect(db, factory=ClosingConnection) as c:
        row = c.execute('select body from official_records where id=?', (desk,)).fetchone()
        link = c.execute('select user_key from desk_user_links where desk_id=?', (desk,)).fetchone()
    return json.loads(row[0]), link and link[0]


@unittest.skipUnless(SEED.is_file(), 'Seed database not available')
class LiveFloorPlan(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.db = root / 'office_atlas.db'
        with fixture_connect(SEED) as a, fixture_connect(self.db) as b:
            a.backup(b)
        self.folder = root / '02_Current_plan'
        self.folder.mkdir()
        self.busy = False
        self.sync = SeatingSync(self.db, root / 'seating-sync.json', root / 'backups', busy=lambda: self.busy)
        with sqlite3.connect(self.db, factory=ClosingConnection) as c:
            records, _ = snapshot(c)
        self.desks = sorted(d for d, r in records.items() if r.get('layout') == 'official' and d.startswith('02R'))
        # Fourteen boxes like the assistants' sheet: two people, team desks, an office, Open.
        self.layout = [
            ['Private Office (209)\n16m2\nGCAS (Baptiste Flais + Manon Desmazes)\n02R010070', 'Credit Sales\n2R017069', 'Compliance\n2R019069'],
            ['Jennifer Aidaoui\n02R011079', 'Credit Sales\n02R017071', 'Market Risk\n2R019071'],
            ['Christophe Duriez\n02R015079', 'Credit Sales\n02R016079', 'Credit Sales\n02R016081'],
            ['Cedric Authier\n02R011081', 'Pierre Haberer\n02R015081', 'TFS Credit\n02R017073'],
            ['Oren Ruban (intern)\n02R010086', 'Sandrine Kone\n2R019073', ''],
        ]

    def write(self, name, rows, age=120):
        path = self.folder / name
        workbook(path, {'+2 (FINAL)': rows, 'Headcount': [['Team', 'Count'], ['Credit', '12']]})
        past = time.time() - age
        os.utime(path, (past, past))
        return path

    def test_plan_changes_reach_the_map_with_a_backup(self):
        self.write('Hoche Project_20261002.xlsx', self.layout)
        self.write('New Joiners 2026.xlsx', [['Name', 'Start'], ['Someone', '01/11/2026']], age=60)
        self.assertEqual(self.sync.summary()['status']['state'], 'off')
        result = self.sync.configure(Settings(folder=f'"{self.folder}"', enabled=True))
        self.assertTrue(result['enabled'], 'Pasted paths in quotes are fine')
        with sqlite3.connect(self.db, factory=ClosingConnection) as c:
            before = seating_version(c)['version']
        first = self.sync.check()
        self.assertEqual(first['status']['state'], 'synced', first['status'])
        self.assertEqual(first['last']['file'], 'Hoche Project_20261002.xlsx', 'A newer non-plan workbook is skipped')
        self.assertEqual([fix['desk'] for fix in first['last']['reader']['fixes']], ['02R017069', '02R019069', '02R019071', '02R019073'])
        record, link = official(self.db, '02R010070')
        self.assertEqual(record['name'], 'Private Office (209) 16m2 GCAS (Baptiste Flais + Manon Desmazes)')
        self.assertEqual(record['occupancy'], 'unconfirmed')
        # Christophe moves to a team desk; his old desk opens.
        moved = [row[:] for row in self.layout]
        moved[2] = ['Open\n02R015079', 'Christophe Duriez\n02R016079', 'Credit Sales\n02R016081']
        self.write('Hoche Project_20261020.xlsx', moved, age=60)
        second = self.sync.check()
        self.assertEqual(second['status']['state'], 'synced', second['status'])
        self.assertEqual(second['last']['counts'].get('moved'), 1, second['last'])
        self.assertEqual(official(self.db, '02R016079')[0]['name'], 'Christophe Duriez')
        self.assertEqual(official(self.db, '02R015079')[0]['occupancy'], 'vacant')
        self.assertTrue(official(self.db, '02R016079')[1], 'The person is linked to their directory account')
        self.assertTrue((self.db.parent / 'backups' / second['history'][0]['backup']).is_file())
        with sqlite3.connect(self.db, factory=ClosingConnection) as c:
            after = seating_version(c)
        self.assertNotEqual(after['version'], before, 'Open maps see a new version')
        self.assertEqual(after['live_plan']['source'], 'Hoche Project_20261020.xlsx')
        self.assertEqual(self.sync.check()['history'], second['history'], 'An unchanged file is not applied twice')

    def test_just_saved_busy_large_and_missing(self):
        self.sync.configure(Settings(folder=str(self.folder), enabled=True))
        self.write('plan.xlsx', self.layout, age=5)
        self.assertEqual(self.sync.check()['status']['state'], 'waiting', 'A file still being saved is read later')
        self.write('plan.xlsx', self.layout)
        self.busy = True
        self.assertEqual(self.sync.check()['status']['state'], 'waiting', 'Seating waits for running jobs')
        self.busy = False
        self.assertEqual(self.sync.check()['status']['state'], 'synced')
        # Vacating 60 desks in one save is held for review, then applied on request.
        free = [[f'Open\n{desk}' for desk in self.desks[i:i + 6]] for i in range(0, 60, 6)]
        self.write('plan.xlsx', free, age=50)
        held = self.sync.check()
        self.assertEqual(held['status']['state'], 'held', held['status'])
        self.assertTrue(held['held']['report']['changes'])
        applied = self.sync.apply_held()
        self.assertEqual(applied['status']['state'], 'synced')
        self.assertIsNone(applied['held'])
        self.sync.configure(Settings(folder=str(self.folder / 'missing'), enabled=True))
        self.assertEqual(self.sync.check()['status']['state'], 'error')
        self.assertEqual(self.sync.configure(Settings(folder='', enabled=True))['enabled'], False)

    def test_review_threshold(self):
        self.assertFalse(large(40, 100))
        self.assertTrue(large(41, 100))
        self.assertFalse(large(60, 400))
        self.assertTrue(large(61, 400))


if __name__ == '__main__':
    unittest.main()
