"""Support tools for a request's PC and person. No PC, WMI or AD is contacted: a stand-in Atlas backend
records the command lines and PowerShell that would run."""
import base64
import json
import re
import tempfile
import types
import unittest
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import support_tools


class Backend:
    def __init__(self):
        self.created, self.scripts, self.ad_answer, self.check_up = [], [], {}, {'ok': True, 'computer': 'LAPTOP-0001', 'errors': []}
        self.busy = False

    def validate_pc(self, pc):
        if not re.fullmatch(r'[A-Za-z0-9-]{1,63}', pc):
            raise HTTPException(400, 'Invalid computer name')
        return pc.upper()

    def wmi_create(self, pc, command):
        self.created.append((pc, command)); return 4242

    def ps(self, script, timeout=120):
        self.scripts.append(script); return json.dumps(self.ad_answer)

    def run(self, args, timeout=120):
        self.args = args
        return types.SimpleNamespace(stdout=json.dumps(self.check_up))

    def identity(self):
        return 'EXAMPLE\\operator'

    @property
    def job_service(self):
        def target_ready(pc):
            if self.busy:
                raise HTTPException(409, f'{pc} has an active deployment.')
        return types.SimpleNamespace(target_ready=target_ready)


class SupportTools(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.backend = Backend()
        def check_token(request):
            if request.headers.get('x-atlas-token') != 'admin':
                raise HTTPException(403, 'Refresh the page before saving')
        app = FastAPI()
        support_tools.register(app, self.backend, check_token, Path(tmp.name) / 'support-notes.json')
        self.addCleanup(setattr, support_tools, 'notes', None)
        self.http = TestClient(app); self.addCleanup(self.http.close)

    def post(self, path, body, token='admin'):
        return self.http.post(path, json=body, headers={'x-atlas-token': token} if token else {})

    def test_message_restart_cancel_and_group_policy(self):
        self.assertEqual(self.post('/api/support/message', {'computer': 'laptop-0001', 'text': 'Hi'}, token=None).status_code, 403)
        sent = self.post('/api/support/message', {'computer': 'laptop-0001', 'text': 'Please save your work: "restart" in 5 minutes\nThanks', 'seconds': 600}).json()
        self.assertEqual(sent, {'computer': 'LAPTOP-0001', 'pid': 4242, 'seconds': 600})
        self.assertEqual(self.backend.created[-1], ('LAPTOP-0001', "msg.exe * /TIME:600 Please save your work: 'restart' in 5 minutes Thanks"))
        self.assertEqual(self.post('/api/support/message', {'computer': 'bad name!', 'text': 'x'}).status_code, 400)
        self.assertEqual(self.post('/api/support/message', {'computer': 'PC1', 'text': 'bell\x07'}).status_code, 422)
        later = self.post('/api/support/restart', {'computer': 'LAPTOP-0001', 'minutes': 15, 'message': 'IT restart for Outlook'}).json()
        self.assertEqual(later['seconds'], 900)
        self.assertEqual(self.backend.created[-1][1], 'shutdown.exe /r /t 900 /d p:0:0 /c "IT restart for Outlook"')
        self.assertEqual(self.post('/api/support/restart', {'computer': 'LAPTOP-0001'}).status_code, 422, 'Minutes or a time')
        self.assertEqual(self.post('/api/support/restart', {'computer': 'LAPTOP-0001', 'at': '25:00'}).status_code, 422)
        self.backend.busy = True
        self.assertEqual(self.post('/api/support/restart', {'computer': 'LAPTOP-0001', 'minutes': 5}).status_code, 409, 'Never during a deployment')
        self.backend.busy = False
        self.post('/api/support/restart/cancel', {'computer': 'LAPTOP-0001'})
        self.assertEqual(self.backend.created[-1][1], 'shutdown.exe /a')
        self.post('/api/support/gpupdate', {'computer': 'LAPTOP-0001'})
        self.assertEqual(self.backend.created[-1][1], 'gpupdate.exe /target:computer /force')

    def test_restart_time_is_today_or_tomorrow(self):
        body = support_tools.Restart(computer='PC1', at='20:00')
        self.assertEqual(support_tools.seconds_until(body, datetime(2026, 10, 21, 19, 30)), 1800)
        self.assertEqual(support_tools.seconds_until(body, datetime(2026, 10, 21, 20, 30)), 23.5 * 3600)

    def test_unlock_and_bitlocker_through_active_directory(self):
        self.backend.ad_answer = {'account': 'X01000001', 'was_locked': True, 'locked': False}
        self.assertEqual(self.post('/api/support/unlock', {'identity': "o'brien@example.test"}).json()['locked'], False)
        script = self.backend.scripts[-1]
        encoded = re.search(r"FromBase64String\('([A-Za-z0-9+/=]+)'\)", script).group(1)
        self.assertEqual(json.loads(base64.b64decode(encoded)), {'identity': "o'brien@example.test", 'server': ''}, 'Input travels as data')
        self.assertNotIn("o'brien", script.replace(encoded, ''))
        self.assertIn('Unlock-ADAccount', script)
        self.backend.ad_answer = {'error': 'Insufficient access rights to perform the operation'}
        refused = self.post('/api/support/unlock', {'identity': 'X01000001'})
        self.assertEqual(refused.status_code, 502)
        self.assertIn('Insufficient access rights', refused.json()['detail'])
        self.assertEqual(self.post('/api/support/unlock', {'identity': 'X01', 'server': '-dc..corp'}).status_code, 422)
        self.backend.ad_answer = {'computer': 'LAPTOP-0001', 'keys': {'id': '1A2B3C4D-0000-0000-0000-000000000000', 'created': '2026-01-05T10:00:00Z', 'password': '111111-222222-333333-444444-555555-666666-777777-888888'}}
        keys = self.post('/api/support/bitlocker', {'computer': 'laptop-0001', 'server': 'dc01.corp.example'}).json()['keys']
        self.assertEqual([key['id'][:8] for key in keys], ['1A2B3C4D'], 'A single key is still a list')
        self.assertEqual(self.post('/api/support/bitlocker', {'computer': 'LAPTOP-0001'}, token=None).status_code, 403)

    def test_check_up_and_its_failures(self):
        self.backend.check_up = {'ok': True, 'computer': 'LAPTOP-0001', 'errors': [], 'session': {'console_user': 'EXAMPLE\\alex'}}
        result = self.http.get('/api/diagnose/laptop-0001?days=3').json()
        self.assertEqual(result['session']['console_user'], 'EXAMPLE\\alex')
        self.assertEqual(self.backend.args[-4:], ['-Computer', 'LAPTOP-0001', '-Days', '3'])
        self.backend.check_up = {'ok': False, 'error': 'The PC did not answer any check: session: RPC server unavailable'}
        failed = self.http.get('/api/diagnose/LAPTOP-0001')
        self.assertEqual(failed.status_code, 502)
        self.assertIn('RPC server unavailable', failed.json()['detail'])
        self.assertEqual(self.http.get('/api/diagnose/LAPTOP-0001?days=90').status_code, 422)

    def test_notes_on_people_and_pcs(self):
        self.assertEqual(self.http.get('/api/support/notes?user=person:1&machine=laptop-0001').json(), {'user': None, 'machine': None})
        self.assertEqual(self.http.put('/api/support/notes', json={'kind': 'machine', 'key': 'laptop-0001', 'text': 'Dock replaced 03/10'}).status_code, 403)
        saved = self.http.put('/api/support/notes', json={'kind': 'machine', 'key': 'laptop-0001', 'text': '  Dock replaced 03/10  '}, headers={'x-atlas-token': 'admin'}).json()
        self.assertEqual((saved['key'], saved['note']['text'], saved['note']['by']), ('LAPTOP-0001', 'Dock replaced 03/10', 'EXAMPLE\\operator'))
        self.http.put('/api/support/notes', json={'kind': 'user', 'key': 'person:1', 'text': 'Prefers Teams'}, headers={'x-atlas-token': 'admin'})
        both = self.http.get('/api/support/notes?user=person:1&machine=Laptop-0001').json()
        self.assertEqual((both['user']['text'], both['machine']['text']), ('Prefers Teams', 'Dock replaced 03/10'))
        self.http.put('/api/support/notes', json={'kind': 'user', 'key': 'person:1', 'text': ''}, headers={'x-atlas-token': 'admin'})
        self.assertIsNone(self.http.get('/api/support/notes?user=person:1').json()['user'], 'An empty note is removed')


if __name__ == '__main__':
    unittest.main()
