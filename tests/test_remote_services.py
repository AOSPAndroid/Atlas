"""Service control uses simulated transport/providers; no live service is stopped."""
import json
import os
from pathlib import Path
import shutil
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from fastapi import HTTPException
import service_actions as services


class RemoteServices(unittest.TestCase):
    def setUp(self):
        self.wmi = SimpleNamespace(
            validate_pc=lambda pc: pc.upper(), quote=lambda value: "'" + str(value).replace("'", "''") + "'",
            ps=Mock(return_value=json.dumps({'ok': True, 'computer': 'TESTPC', 'items': []})), identity=lambda: 'TEST OPERATOR',
        )

    def request(self, **changes):
        return SimpleNamespace(**dict(dict(computer='testpc', name='TestService', expected_identity='a' * 64), **changes))

    def test_inventory_is_explicit_targeted_and_bounded(self):
        self.assertEqual(services.list_services(self.wmi, 'testpc')['items'], [])
        command = self.wmi.ps.call_args
        self.assertIn("-Computer 'TESTPC' -Action 'list'", command.args[0])
        self.assertEqual(command.kwargs['timeout'], 60)

    def test_stop_passes_exact_name_and_identity_without_shell_interpolation(self):
        self.wmi.ps.return_value = json.dumps({'ok': True, 'computer': 'TESTPC', 'name': "Test's service", 'outcome': 'stopped', 'state': 'Stopped'})
        result = services.stop_service(self.wmi, self.request(name="Test's service"))
        self.assertEqual(result['outcome'], 'stopped')
        self.assertIn("-Name 'Test''s service'", self.wmi.ps.call_args.args[0])
        self.assertIn("-ExpectedIdentity '" + 'a' * 64 + "'", self.wmi.ps.call_args.args[0])

    def test_invalid_identity_or_name_never_calls_windows(self):
        for changes in [dict(name=''), dict(name='a' * 257), dict(name='Test\nService'), dict(expected_identity=''), dict(expected_identity='*')]:
            with self.subTest(changes=changes), self.assertRaises(HTTPException):
                services.stop_service(self.wmi, self.request(**changes))
        self.wmi.ps.assert_not_called()

    def test_wrong_target_and_unverified_success_are_rejected(self):
        baseline = {'ok': True, 'computer': 'TESTPC', 'name': 'TestService', 'outcome': 'stopped', 'state': 'Stopped'}
        for changes in [dict(computer='OTHER'), dict(name='OtherService'), dict(state='Stop Pending'), dict(outcome='unknown')]:
            self.wmi.ps.return_value = json.dumps(dict(baseline, **changes))
            with self.subTest(changes=changes), self.assertRaises(HTTPException):
                services.stop_service(self.wmi, self.request())

    def test_pending_and_failure_are_not_reported_as_stopped(self):
        for outcome in ['pending', 'failed', 'blocked', 'gone', 'changed', 'already_stopped']:
            self.wmi.ps.return_value = json.dumps({'ok': True, 'computer': 'TESTPC', 'name': 'TestService', 'outcome': outcome, 'state': 'Stopped' if outcome == 'already_stopped' else 'Running'})
            self.assertEqual(services.stop_service(self.wmi, self.request())['outcome'], outcome)
        self.wmi.ps.side_effect = subprocess.TimeoutExpired('simulated', 60)
        with self.assertRaises(HTTPException) as error: services.stop_service(self.wmi, self.request())
        self.assertIn('outcome may be unknown', error.exception.detail)

    @unittest.skipUnless(os.name == 'nt' or shutil.which('pwsh'), 'PowerShell is unavailable')
    def test_windows_service_provider_fixture(self):
        executable = 'powershell.exe' if os.name == 'nt' else shutil.which('pwsh')
        result = subprocess.run([executable, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(Path(__file__).with_name('remote_services_fixture.ps1'))], capture_output=True, text=True, errors='replace', timeout=30, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('PASS:', result.stdout)


if __name__ == '__main__': unittest.main()
