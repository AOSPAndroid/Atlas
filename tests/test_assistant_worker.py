"""The llama-cpp-python route: worker process, request mapping, start/stop through Atlas, installer choices."""
import json
import os
import socket
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import assistant_worker
import install_assistant
from local_assistant import AssistantError, Runtime

# A stand-in for the native library: same names, canned answer, records what it was asked.
FAKE_LLAMA_CPP = '''
__version__ = "0.3.19-test"
CALLS = []
def llama_supports_gpu_offload():
    return False
class Llama:
    def __init__(self, model_path, n_gpu_layers, n_ctx, verbose):
        if open(model_path).read().startswith("broken"):
            raise ValueError("Failed to load model from file")
        self.args = dict(model_path=model_path, n_gpu_layers=n_gpu_layers, n_ctx=n_ctx)
    def create_chat_completion(self, messages, **options):
        CALLS.append(options)
        import json
        return {"choices": [{"message": {"role": "assistant", "content": json.dumps({"ok": True, "format": options.get("response_format")})},
                             "finish_reason": "stop"}], "usage": {"completion_tokens": 5}}
'''


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class Mapping(unittest.TestCase):
    def test_json_schema_becomes_a_grammar_constrained_json_object(self):
        schema = {'type': 'object', 'properties': {'a': {'type': 'string'}}}
        self.assertEqual(assistant_worker.response_format({'type': 'json_schema', 'json_schema': {'name': 'answer', 'schema': schema}}),
                         {'type': 'json_object', 'schema': schema})
        self.assertEqual(assistant_worker.response_format({'type': 'json_object'}), {'type': 'json_object'})
        self.assertIsNone(assistant_worker.response_format(None))

    def test_app_answers_the_openai_subset_atlas_uses(self):
        calls = []

        class Llm:
            def create_chat_completion(self, messages, **options):
                calls.append((messages, options))
                return {'choices': [{'message': {'content': '{}'}, 'finish_reason': 'stop'}]}
        client = TestClient(assistant_worker.build_app(Llm(), 'model.gguf'))
        self.assertEqual(client.get('/v1/models').json()['data'][0]['id'], 'model.gguf')
        body = {'messages': [{'role': 'user', 'content': 'hi'}], 'temperature': 0, 'top_p': 1, 'seed': 2, 'max_tokens': 50,
                'chat_template_kwargs': {'enable_thinking': False},
                'response_format': {'type': 'json_schema', 'json_schema': {'name': 'answer', 'strict': True, 'schema': {'type': 'object'}}}}
        self.assertEqual(client.post('/v1/chat/completions', json=body).status_code, 200)
        self.assertEqual(calls[0][1], {'temperature': 0.0, 'top_p': 1.0, 'max_tokens': 50, 'seed': 2,
                                       'response_format': {'type': 'json_object', 'schema': {'type': 'object'}}})
        self.assertEqual(client.post('/v1/chat/completions', json={'messages': []}).status_code, 400)

    def test_missing_library_is_explained(self):
        with patch.dict(sys.modules, {'llama_cpp': None}), patch('builtins.print') as printed:
            self.assertEqual(assistant_worker.main(['--model', 'm.gguf', '--port', '1']), 2)
        self.assertIn('Run Install-Assistant.bat', printed.call_args.args[0])


class ThroughAtlas(unittest.TestCase):
    """Atlas without llama-server.exe: the worker process with the (stand-in) library."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / 'llm').mkdir()
        (self.root / 'llm' / 'Qwen2.5-7B-Instruct-Q4_K_M.gguf').write_text('model', encoding='utf-8')
        fake = self.root / 'fake'
        (fake / 'llama_cpp').mkdir(parents=True)
        (fake / 'llama_cpp' / '__init__.py').write_text(textwrap.dedent(FAKE_LLAMA_CPP), encoding='utf-8')
        self.env = patch.dict(os.environ, {'PYTHONPATH': os.pathsep.join([str(fake), str(Path(__file__).resolve().parents[1])])})
        self.env.start()
        sys.path.insert(0, str(fake))
        self.runtime = Runtime({'assistant': {'port': free_port(), 'gpu_layers': 99, 'context': 4096}}, self.root)

    def tearDown(self):
        self.runtime.stop()
        sys.path.remove(str(self.root / 'fake'))
        sys.modules.pop('llama_cpp', None)
        self.env.stop()
        self.tmp.cleanup()

    def test_atlas_uses_the_library_when_there_is_no_llama_server(self):
        status = self.runtime.status()
        self.assertEqual((status['mode'], status['configured'], status['python_library']), ('python', True, True))
        mode, command = self.runtime.launch_command(self.runtime.settings())
        self.assertEqual(command[1:3], [str(Path(assistant_worker.__file__).resolve()), '--model'])
        self.assertEqual(command[-6:], ['--port', str(self.runtime.settings()['port']), '--gpu-layers', '99', '--context', '4096'])
        answer, meta = self.runtime.chat('system', 'user', {'type': 'object'})
        self.assertEqual(answer, {'ok': True, 'format': {'type': 'json_object', 'schema': {'type': 'object'}}})
        self.assertTrue(self.runtime.status()['started_by_atlas'])
        log = (self.root / 'data' / 'assistant-server.log').read_text()
        self.assertIn('llama-cpp-python 0.3.19-test, graphics card not used (CPU build)', log)
        self.runtime.stop()
        self.assertFalse(self.runtime.ready())

    def test_a_model_the_library_cannot_read_is_explained(self):
        (self.root / 'llm' / 'Qwen2.5-7B-Instruct-Q4_K_M.gguf').write_text('broken', encoding='utf-8')
        self.runtime.start()
        with self.assertRaises(AssistantError) as caught:
            self.runtime.wait_ready(30)
        self.assertIn('failed to load Qwen2.5-7B-Instruct-Q4_K_M.gguf with llama-cpp-python 0.3.19-test', str(caught.exception))

    def test_llama_server_wins_when_both_are_there(self):
        exe = self.root / 'llm' / ('llama-server.exe' if os.name == 'nt' else 'llama-server')
        exe.write_text('', encoding='utf-8')
        self.assertEqual(self.runtime.launch_command(self.runtime.settings())[0], 'llama-server')


class Installer(unittest.TestCase):
    def test_choices_are_ready_built_packages_only(self):
        gpu, = install_assistant.commands('gpu')
        self.assertEqual(gpu[1:5], ['-m', 'pip', 'install', '--only-binary=:all:'])
        self.assertIn('https://abetlen.github.io/llama-cpp-python/whl/cu124', gpu)
        self.assertIn('llama-cpp-python==0.3.4', gpu)
        self.assertIn('nvidia-cublas-cu12==12.4.5.8', gpu)
        cpu, = install_assistant.commands('cpu')
        self.assertIn('llama-cpp-python==0.3.19', cpu)
        self.assertIn('https://abetlen.github.io/llama-cpp-python/whl/cpu', cpu)

    def test_an_nvidia_card_selects_the_cuda_build_unless_cpu_is_asked(self):
        with patch.object(install_assistant, 'nvidia_card', return_value='NVIDIA RTX A2000 8GB, 8188 MiB'), patch('builtins.print') as printed:
            self.assertEqual(install_assistant.main(['--dry-run']), 0)
            self.assertIn('whl/cu124', ' '.join(' '.join(map(str, c.args)) for c in printed.call_args_list))
            printed.reset_mock()
            install_assistant.main(['--dry-run', '--cpu'])
            self.assertIn('whl/cpu', ' '.join(' '.join(map(str, c.args)) for c in printed.call_args_list))
        with patch.object(install_assistant, 'nvidia_card', return_value=''), patch('builtins.print') as printed:
            install_assistant.main(['--dry-run'])
            self.assertIn('processor build', ' '.join(' '.join(map(str, c.args)) for c in printed.call_args_list))

    def test_a_blocked_download_site_prints_the_file_to_download(self):
        with patch.object(install_assistant, 'nvidia_card', return_value='NVIDIA RTX A2000 8GB, 8188 MiB'), \
                patch.object(install_assistant, 'local_package', return_value=None), \
                patch.object(install_assistant, 'reachable', return_value=False), \
                patch.object(install_assistant.subprocess, 'run') as run, patch('builtins.print') as printed:
            self.assertEqual(install_assistant.main([]), 1)
        run.assert_not_called()
        text = ' '.join(' '.join(map(str, c.args)) for c in printed.call_args_list)
        self.assertIn('pip cannot reach abetlen.github.io', text)
        self.assertIn('https://github.com/abetlen/llama-cpp-python/releases/download/v0.3.4-cu124/llama_cpp_python-0.3.4-cp312-cp312-win_amd64.whl', text)
        self.assertIn('Atlas\\llm', text)

    def test_a_downloaded_package_is_installed_from_the_file(self):
        tag = f'cp{sys.version_info.major}{sys.version_info.minor}'
        with tempfile.TemporaryDirectory() as folder:
            self.assertIsNone(install_assistant.local_package([folder]))
            wheel = Path(folder) / f'llama_cpp_python-0.3.4-{tag}-{tag}-win_amd64.whl'
            wheel.write_bytes(b'')
            (Path(folder) / 'llama_cpp_python-0.3.4-cp27-cp27-win_amd64.whl').write_bytes(b'')
            self.assertEqual(install_assistant.local_package([folder]), wheel, 'Only a file for this Python version')
        command, = install_assistant.commands('gpu', wheel, card='RTX A2000, 8188 MiB')
        self.assertEqual(command[1:6], ['-m', 'pip', 'install', '--only-binary=:all:', str(wheel)])
        self.assertNotIn('--extra-index-url', command, 'Only the normal package mirror is used')
        self.assertEqual(command[6:], install_assistant.NVIDIA)
        command, = install_assistant.commands('cpu', wheel, card='')
        self.assertEqual(command[5:], [str(wheel)], 'No NVIDIA runtime without a card')
        with patch.object(install_assistant, 'nvidia_card', return_value='RTX A2000, 8188 MiB'), \
                patch.object(install_assistant, 'local_package', return_value=wheel), \
                patch.object(install_assistant, 'reachable', side_effect=AssertionError('no network check needed')), \
                patch('builtins.print') as printed:
            self.assertEqual(install_assistant.main(['--dry-run']), 0)
        self.assertIn('Using the downloaded package', ' '.join(' '.join(map(str, c.args)) for c in printed.call_args_list))

    def test_model_advice_follows_graphics_memory(self):
        self.assertEqual(install_assistant.memory_gb('RTX A2000 8GB, 8188 MiB'), 8.0)
        self.assertIn('Qwen2.5-7B', install_assistant.model_for('gpu', 'RTX A2000 8GB, 8188 MiB'))
        self.assertIn('Qwen2.5-3B', install_assistant.model_for('gpu', 'Quadro P620, 4096 MiB'))
        self.assertIn('Qwen3-4B', install_assistant.model_for('cpu', ''))

    def test_the_check_adds_nvidia_dlls_before_loading_the_library(self):
        with patch.object(install_assistant.subprocess, 'run') as run:
            run.return_value.returncode, run.return_value.stdout, run.return_value.stderr = 0, '0.3.4 True\n', ''
            self.assertEqual(install_assistant.check(), (True, ['0.3.4 True']))
        script = run.call_args.args[0][2]
        self.assertLess(script.index('add_cuda_dlls()'), script.index('import llama_cpp'))

    def test_no_nvidia_tool_means_no_card(self):
        with patch.object(install_assistant.shutil, 'which', return_value=None), \
                patch.object(install_assistant.subprocess, 'run', side_effect=OSError('not found')):
            self.assertEqual(install_assistant.nvidia_card(), '')


if __name__ == '__main__':
    unittest.main()
