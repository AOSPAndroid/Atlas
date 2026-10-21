"""The Atlas Companion inside the real Atlas app: its waiting poll must not hold up other requests.
Atlas serialises POST requests behind a mutation gate (database_manager); a 20-second poll holding it
would stall deployments, settings and every other change while the Companion waits for a command."""
from sqlite_fixture import isolate_backend_database
isolate_backend_database()
import sys, tempfile, threading, time, unittest
from unittest.mock import patch
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT))
from backend import main as app
import atlas_api
import companion_core as core
import companion_server
from fastapi.testclient import TestClient


class CompanionInsideAtlas(unittest.TestCase):
    def test_a_waiting_poll_does_not_block_other_changes(self):
        # Other test modules replace the module-level Companion; use the one Atlas registered.
        restore = patch.object(companion_server, 'companion', app._companion); restore.start(); self.addCleanup(restore.stop)
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        for name, value in (('_state_path', Path(tmp.name) / 'companion-state.json'), ('_inbox', Path(tmp.name) / 'companion-inbox'), ('state', {})):
            patcher = patch.object(app._companion, name, value); patcher.start(); self.addCleanup(patcher.stop)
        client = TestClient(app.app, base_url='http://127.0.0.1', client=('127.0.0.1', 12345)); self.addCleanup(client.close)
        key = companion_server.companion.token()
        companion = {'x-atlas-companion': key}
        self.assertEqual(client.post('/api/companion/hello', json={'version': core.VERSION, 'user': 'EXAMPLE\\operator', 'capabilities': list(core.CAPABILITIES)}, headers=companion).status_code, 200)
        answered = {}
        def poll():
            answered['commands'] = client.post('/api/companion/poll', json={'wait': 3}, headers=companion).json()['commands']
            answered['at'] = time.monotonic()
        started = time.monotonic()
        waiting = threading.Thread(target=poll, daemon=True); waiting.start()
        time.sleep(0.3)
        admin, results = {'x-atlas-token': atlas_api.TOKEN}, {}
        def changes():
            results['command'] = client.post('/api/companion/commands', json={'kind': 'open.url', 'args': {'url': 'https://example.test'}}, headers=admin)
            results['settings'] = client.post('/api/companion/settings', json={'alerts': True}, headers=admin)
        other = threading.Thread(target=changes, daemon=True); other.start(); other.join(1.5)
        self.assertFalse(other.is_alive(), 'Other changes are not held up while the Companion waits')
        self.assertEqual((results['command'].status_code, results['settings'].status_code), (200, 200))
        waiting.join(5)
        self.assertEqual([c['kind'] for c in answered['commands']], ['open.url'])
        self.assertLess(answered['at'] - started, 1.5, 'The waiting poll is woken by the command, not by its timeout')


if __name__ == '__main__':
    unittest.main()
