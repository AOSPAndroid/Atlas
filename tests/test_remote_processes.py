"""No real process is terminated: transport and Windows providers are simulated."""
import json
import os
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from fastapi import HTTPException
import remote_processes as rp


class RemoteProcesses(unittest.TestCase):
    def setUp(self):
        self.wmi = SimpleNamespace(
            validate_pc=lambda pc: pc.upper(), quote=lambda value: "'" + str(value).replace("'", "''") + "'",
            ps=Mock(return_value=json.dumps({'ok': True, 'items': []})), identity=lambda: 'TEST OPERATOR',
        )

    def request(self, **values):
        return SimpleNamespace(**dict(dict(computer='testpc', value='42', created=None, name=None), **values))

    def test_kind_and_process_validation(self):
        for kind in ['cpu', 'gpu', 'memory']:
            self.assertEqual(rp.list_processes(self.wmi, 'testpc', kind), [])
        self.wmi.ps.reset_mock()
        with self.assertRaises(HTTPException): rp.list_processes(self.wmi, 'PC', 'arbitrary')
        for values in [dict(value='0'), dict(value='4'), dict(value='4294967296'), dict(value="app';evil"), dict(created='bad', name='app.exe'), dict(created='20260910100000.000000+000')]:
            with self.subTest(values=values), self.assertRaises(HTTPException): rp.terminate(self.wmi, self.request(**values))
        self.wmi.ps.assert_not_called()

    def test_identity_passed_without_shell_interpolation(self):
        self.wmi.ps.return_value = json.dumps({'ok': True, 'count': 1, 'failed': 0, 'results': []})
        result = rp.terminate(self.wmi, self.request(created='20260910100000.000000+000', name="app's.exe"))
        self.assertEqual(result['count'], 1)
        command = self.wmi.ps.call_args.args[0]
        self.assertIn("-Computer 'TESTPC'", command)
        self.assertIn("-ExpectedName 'app''s.exe'", command)
        self.assertIn("-Value '42'", command)

    def test_failure_and_uncertain_outcomes(self):
        for result in ['not json', json.dumps({'ok': False, 'error': 'WMI denied'})]:
            self.wmi.ps.return_value = result
            with self.assertRaises(HTTPException) as error: rp.terminate(self.wmi, self.request())
            self.assertEqual(error.exception.status_code, 502)
            self.assertIn('outcome may be unknown', error.exception.detail)
        self.wmi.ps.side_effect = subprocess.TimeoutExpired('mock', 60)
        with self.assertRaises(HTTPException): rp.list_processes(self.wmi, 'PC', 'gpu')

    @unittest.skipUnless(os.name == 'nt', 'PowerShell provider fixture requires Windows')
    def test_windows_provider_fixture(self):
        result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(Path(__file__).with_name('remote_processes_fixture.ps1'))], capture_output=True, text=True, errors='replace', timeout=30, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('PASS:', result.stdout)


if __name__ == '__main__': unittest.main()
