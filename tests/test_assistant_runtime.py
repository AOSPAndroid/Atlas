"""Offline assistant lifecycle tests. No real model, listener or machine scan."""
import asyncio
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

from fastapi import HTTPException
import assistant_runtime as runtime


class Request:
    def __init__(self, disconnected=False):
        self.disconnected = disconnected

    async def is_disconnected(self):
        return self.disconnected


class Process:
    """A pipe worker whose lifetime is observable without starting a process."""
    def __init__(self, payload='{"answer":"  Evidence first.  "}', code=0,
                 blocked=False, ignore_terminate=False, communicate_error=None,
                 terminate_error=None):
        self.payload = payload
        self.code = code
        self.returncode = None
        self.blocked = blocked
        self.ignore_terminate = ignore_terminate
        self.communicate_error = communicate_error
        self.terminate_error = terminate_error
        self.started = threading.Event()
        self.finished = threading.Event()
        self.input = None
        self.terminated = False
        self.killed = False

    def communicate(self, text):
        self.input = text
        self.started.set()
        if self.blocked and not self.finished.wait(10):
            raise TimeoutError('Test worker was not stopped')
        if self.returncode is None:
            self.returncode = self.code
        self.finished.set()
        if self.communicate_error:
            raise self.communicate_error
        return self.payload, 'Private native diagnostic: C:/model'

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated = True
        if self.terminate_error:
            raise self.terminate_error
        if not self.ignore_terminate:
            self.returncode = -15
            self.finished.set()

    def kill(self):
        self.killed = True
        self.returncode = -9
        self.finished.set()

    def wait(self, timeout=None):
        if not self.finished.wait(timeout):
            raise subprocess.TimeoutExpired('mock assistant', timeout)
        return self.returncode


class AssistantStatus(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.model = self.root / 'model'
        self.model.mkdir()
        self.manifest = self.root / 'manifest.json'
        self.python = self.root / 'python.exe'
        self.manifest_patch = patch.object(runtime, 'MANIFEST', self.manifest)
        self.model_patch = patch.object(runtime, 'MODEL_DIR', self.model)
        self.python_patch = patch.object(runtime, 'python_path', return_value=self.python)
        for mock in (self.manifest_patch, self.model_patch, self.python_patch):
            mock.start()
            self.addCleanup(mock.stop)

    def install_fixture(self):
        model_file = self.model / 'model.onnx'
        model_file.write_bytes(b'not a model')
        self.python.write_bytes(b'not an executable')
        raw = json.dumps({'name': 'Fixture model', 'files': [
            {'path': model_file.name, 'size': model_file.stat().st_size}
        ]}).encode()
        self.manifest.write_bytes(raw)
        marker = {'manifest_sha256': hashlib.sha256(raw).hexdigest(), 'files': {
            model_file.name: {'mtime_ns': model_file.stat().st_mtime_ns}
        }}
        (self.model / '.verified.json').write_text(json.dumps(marker), encoding='utf-8')

    def test_status_checks_metadata_without_starting_worker(self):
        with patch.object(runtime.subprocess, 'Popen') as spawn:
            self.assertFalse(runtime.status()['available'])
            self.install_fixture()
            result = runtime.status()
            self.assertTrue(result['available'])
            self.assertEqual(result['model'], 'Fixture model')
            spawn.assert_not_called()

    def test_changed_model_manifest_or_environment_requires_setup(self):
        self.install_fixture()
        (self.model / 'model.onnx').write_bytes(b'changed')
        self.assertFalse(runtime.status()['available'])
        self.install_fixture()
        self.manifest.write_text('{}', encoding='utf-8')
        self.assertFalse(runtime.status()['available'])
        self.install_fixture()
        self.python.unlink()
        self.assertFalse(runtime.status()['available'])

    def test_corrupt_verification_metadata_does_not_break_status(self):
        self.install_fixture()
        for metadata in ('not json', 'null', '[]', '"invalid"'):
            with self.subTest(metadata=metadata):
                (self.model / '.verified.json').write_text(metadata, encoding='utf-8')
                self.assertFalse(runtime.status()['available'])


class AssistantGeneration(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.slot = threading.Lock()
        self.slot_patch = patch.object(runtime, 'SLOT', self.slot)
        self.slot_patch.start()
        self.addCleanup(self.slot_patch.stop)
        self.ready = patch.object(runtime, 'status', return_value={
            'available': True, 'reason': '', 'setup': 'Install the assistant.'})
        self.status = self.ready.start()
        self.addCleanup(self.ready.stop)
        self.messages = [{'role': 'system', 'content': 'Use the evidence.'},
                         {'role': 'user', 'content': 'Explain these saved results.'}]

    def assert_slot_released(self):
        self.assertTrue(self.slot.acquire(blocking=False), 'Assistant capacity was leaked')
        self.slot.release()

    async def test_missing_model_or_busy_slot_never_spawns(self):
        with patch.object(runtime.subprocess, 'Popen') as spawn:
            self.status.return_value['available'] = False
            self.status.return_value['reason'] = 'Model absent.'
            with self.assertRaises(HTTPException) as error:
                await runtime.generate(self.messages, Request())
            self.assertEqual(error.exception.status_code, 503)
            self.status.return_value['available'] = True
            self.slot.acquire()
            try:
                with self.assertRaises(HTTPException) as error:
                    await runtime.generate(self.messages, Request())
                self.assertEqual(error.exception.status_code, 429)
            finally:
                self.slot.release()
            spawn.assert_not_called()

    async def test_success_uses_isolated_python_pipes_and_releases_capacity(self):
        process = Process()
        with patch.object(runtime.subprocess, 'Popen', return_value=process) as spawn:
            answer = await runtime.generate(self.messages, Request())
        self.assertEqual(answer, 'Evidence first.')
        self.assertEqual(json.loads(process.input), {'messages': self.messages})
        command = spawn.call_args.args[0]
        self.assertIn('-I', command)
        self.assertEqual(command[command.index('-X') + 1], 'utf8')
        self.assertTrue(command[-2].endswith('worker.py'))
        options = spawn.call_args.kwargs
        self.assertEqual(options['stdin'], subprocess.PIPE)
        self.assertEqual(options['stdout'], subprocess.PIPE)
        self.assertEqual(options['stderr'], subprocess.PIPE)
        self.assertEqual(options['env']['HF_HUB_OFFLINE'], '1')
        self.assertEqual(options['env']['OMP_NUM_THREADS'], '4')
        self.assertFalse(process.terminated)
        self.assert_slot_released()

    async def test_incomplete_answer_is_labelled_without_automatic_continuation(self):
        process = Process('{"answer":"First troubleshooting step.","truncated":true}')
        with patch.object(runtime.subprocess, 'Popen', return_value=process) as spawn:
            answer = await runtime.generate(self.messages, Request())
        self.assertTrue(answer.startswith('First troubleshooting step.'))
        self.assertIn('This answer is incomplete.', answer)
        spawn.assert_called_once()
        self.assert_slot_released()

    async def test_worker_errors_and_invalid_protocol_return_controlled_errors(self):
        examples = [
            ('{"kind":"context","error":"Question too large."}', 2, 422),
            ('{"kind":"runtime","error":"Model unavailable."}', 1, 503),
            ('not json', 0, 503), ('null', 0, 503), ('[]', 0, 503),
            ('"answer"', 0, 503), ('{}', 0, 503), ('{"answer":" "}', 0, 503),
            ('{"answer":"valid but worker failed"}', 1, 503),
        ]
        for payload, code, expected in examples:
            with self.subTest(payload=payload), patch.object(
                    runtime.subprocess, 'Popen', return_value=Process(payload, code)):
                with self.assertRaises(HTTPException) as error:
                    await runtime.generate(self.messages, Request())
                self.assertEqual(error.exception.status_code, expected)
                self.assertNotIn('C:/model', str(error.exception.detail))
                self.assert_slot_released()

    async def test_spawn_or_pipe_failure_does_not_leak_capacity(self):
        for source in ('spawn', 'pipe'):
            with self.subTest(source=source):
                failure = OSError('Private path must not reach client')
                worker = Process(communicate_error=failure)
                kwargs = {'side_effect': failure} if source == 'spawn' else {'return_value': worker}
                with patch.object(runtime.subprocess, 'Popen', **kwargs):
                    with self.assertRaises(HTTPException) as error:
                        await runtime.generate(self.messages, Request())
                self.assertEqual(error.exception.status_code, 503)
                self.assertNotIn('Private path', str(error.exception.detail))
                self.assert_slot_released()

    async def test_disconnect_and_deadline_stop_worker_and_release_capacity(self):
        for disconnected in (True, False):
            process = Process(blocked=True)
            with self.subTest(disconnected=disconnected), patch.object(
                    runtime.subprocess, 'Popen', return_value=process), patch.object(
                    runtime, 'TIMEOUT', 0 if not disconnected else 120):
                with self.assertRaises(HTTPException) as error:
                    await runtime.generate(self.messages, Request(disconnected))
                self.assertEqual(error.exception.status_code, 499 if disconnected else 504)
                self.assertTrue(process.terminated)
                self.assertIsNotNone(process.returncode)
                self.assert_slot_released()

    async def test_cancelled_request_stops_worker_and_releases_capacity(self):
        process = Process(blocked=True)
        with patch.object(runtime.subprocess, 'Popen', return_value=process):
            task = asyncio.create_task(runtime.generate(self.messages, Request()))
            for _ in range(100):
                if process.started.is_set():
                    break
                await asyncio.sleep(.005)
            self.assertTrue(process.started.is_set())
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertTrue(process.terminated)
        self.assertIsNotNone(process.returncode)
        self.assert_slot_released()

    async def test_unresponsive_worker_is_killed_after_cleanup_grace(self):
        process = Process(blocked=True, ignore_terminate=True)
        original_wait_for = asyncio.wait_for

        async def short_cleanup(awaitable, timeout):
            return await original_wait_for(awaitable, min(timeout, .03))

        with patch.object(runtime.subprocess, 'Popen', return_value=process), patch.object(
                runtime.asyncio, 'wait_for', side_effect=short_cleanup):
            with self.assertRaises(HTTPException) as error:
                await runtime.generate(self.messages, Request(True))
        self.assertEqual(error.exception.status_code, 499)
        self.assertTrue(process.terminated)
        self.assertTrue(process.killed)
        self.assert_slot_released()

    async def test_terminate_failure_falls_back_to_kill_and_releases_capacity(self):
        process = Process(blocked=True, terminate_error=OSError('Terminate raced'))
        with patch.object(runtime.subprocess, 'Popen', return_value=process):
            with self.assertRaises(HTTPException) as error:
                await runtime.generate(self.messages, Request(True))
        self.assertEqual(error.exception.status_code, 499)
        self.assertTrue(process.terminated)
        self.assertTrue(process.killed)
        self.assert_slot_released()


if __name__ == '__main__':
    unittest.main()
