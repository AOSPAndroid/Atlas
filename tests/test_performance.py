"""Performance tests use simulated providers and never query a remote machine."""
import json
import os
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from fastapi import HTTPException
import performance as p


class Performance(unittest.TestCase):
    def setUp(self):
        self.wmi = SimpleNamespace(validate_pc=lambda pc: pc.upper(), run=Mock(return_value=SimpleNamespace(stdout=json.dumps({'ok': True, 'items': [{'PID': 42, 'Process': 'app.exe', 'CreatedAt': '20260910100000.000000+000'}]}))))

    def test_validation_before_transport(self):
        for args in [dict(kind='invalid'), dict(kind='threads', pid=0), dict(kind='threads', pid=42, created='invalid', name='app.exe'), dict(kind='threads', pid=42, created='20260910100000.000000+000', name='bad\nname')]:
            with self.subTest(args=args), self.assertRaises(HTTPException) as error:
                p.collect(self.wmi, 'testpc', **args)
            self.assertEqual(error.exception.status_code, 400)
        self.wmi.run.assert_not_called()

    def test_snapshot_and_argument_transport(self):
        result = p.collect(self.wmi, 'testpc')
        self.assertTrue(result['items'][0]['CanTerminate'])
        p.collect(self.wmi, 'testpc', 'threads', pid=42, created='20260910100000.000000+000', name="app's.exe")
        args = self.wmi.run.call_args.args[0]
        self.assertEqual(args[-1], "app's.exe")
        self.assertIn('-File', args)
        self.assertEqual(self.wmi.run.call_args.kwargs['timeout'], 60)
        self.assertFalse(p.ACTIVE)

    def test_failure_releases_slot_and_same_target_is_bounded(self):
        def pending(*args, **kwargs):
            with self.assertRaises(HTTPException) as error:
                p.collect(self.wmi, 'testpc')
            self.assertEqual(error.exception.status_code, 429)
            raise subprocess.TimeoutExpired('simulated', 60)
        self.wmi.run.side_effect = pending
        with self.assertRaises(HTTPException) as error:
            p.collect(self.wmi, 'testpc')
        self.assertEqual(error.exception.status_code, 502)
        self.assertFalse(p.ACTIVE)
        self.wmi.run.side_effect = None
        p.collect(self.wmi, 'testpc')

    @unittest.skipUnless(os.name == 'nt', 'Windows PowerShell fixture')
    def test_windows_counter_math(self):
        result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(Path(__file__).with_name('performance_fixture.ps1'))], capture_output=True, text=True, errors='replace', timeout=30, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('PASS:', result.stdout)


if __name__ == '__main__':
    unittest.main()
