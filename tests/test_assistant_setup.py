"""Tiny offline fixtures for the optional model installer; no packages or network."""
from contextlib import redirect_stdout
import copy
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
from types import ModuleType
import unittest
from unittest.mock import patch

from scripts import setup_assistant as installer


def sha256(data):
    return hashlib.sha256(data).hexdigest()


class AssistantSetup(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest_path = self.root / 'model-manifest.json'
        self.model = self.root / 'model'
        self.cache = self.root / 'cache'
        self.assets = self.root / 'assets'
        self.assets.mkdir()
        self.contents = {
            'model.onnx': b'fixture graph',
            'model.onnx.data': b'one\x00two\xffthree:split weights',
            'genai_config.json': b'{"model":"fixture"}',
            'tokenizer.json': b'{"tokens":[]}',
            'chat_template.jinja': b'fixture template',
            'LICENSE': b'Tiny fixture only, not model weights.',
        }
        files = []
        for name, content in self.contents.items():
            segments = [content]
            if name == 'model.onnx.data':
                segments = [content[:7], content[7:13], content[13:]]
            parts = []
            for index, segment in enumerate(segments):
                part_name = f'{name}.part{index+1:02d}' if len(segments) > 1 else name
                (self.assets / part_name).write_bytes(segment)
                parts.append({'name': part_name, 'size': len(segment), 'sha256': sha256(segment)})
            files.append({'path': name, 'size': len(content), 'sha256': sha256(content), 'assets': parts})
        self.manifest = {
            'schema': 1, 'id': 'atlas-qwen3-4b', 'name': 'Fixture model',
            'release_base': 'https://github.com/AOSPAndroid/BAtlas/releases/download/test-fixture',
            'runtime': 'onnxruntime-genai==0.15.2', 'files': files,
        }
        self.write_manifest()
        patches = [
            patch.object(installer, 'MANIFEST', self.manifest_path),
            patch.object(installer, 'MODEL', self.model),
            patch.object(installer, 'CACHE', self.cache),
            patch.object(installer.importlib.metadata, 'version', return_value='0.15.2'),
            patch.dict(sys.modules, {'onnxruntime_genai': ModuleType('onnxruntime_genai')}),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)
        self.network_patch = patch.object(installer.urllib.request, 'urlopen', side_effect=AssertionError('Unexpected network call'))
        self.network = self.network_patch.start()
        self.addCleanup(self.network_patch.stop)

    def write_manifest(self):
        self.manifest_path.write_text(json.dumps(self.manifest), encoding='utf-8')

    def run_setup(self, *arguments):
        with patch.object(sys, 'argv', ['setup_assistant.py', *arguments]), redirect_stdout(io.StringIO()):
            installer.main()

    def seed_marker(self):
        self.model.mkdir(exist_ok=True)
        (self.model / '.verified.json').write_text('{"old":true}', encoding='utf-8')

    def assert_no_marker(self):
        self.assertFalse((self.model / '.verified.json').exists())

    def test_offline_assets_assemble_all_bytes_and_atomically_verify(self):
        source_files = {path.name: path.read_bytes() for path in self.assets.iterdir()}
        self.run_setup('--assets', str(self.assets))
        for name, expected in self.contents.items():
            self.assertEqual((self.model / name).read_bytes(), expected)
            self.assertFalse((self.model / name).with_suffix(Path(name).suffix + '.installing').exists())
        marker = json.loads((self.model / '.verified.json').read_text(encoding='utf-8'))
        self.assertEqual(marker['manifest_sha256'], sha256(self.manifest_path.read_bytes()))
        self.assertEqual(set(marker['files']), set(self.contents))
        for name, expected in self.contents.items():
            entry = marker['files'][name]
            self.assertEqual(entry['size'], len(expected))
            self.assertEqual(entry['sha256'], sha256(expected))
            self.assertEqual(entry['mtime_ns'], (self.model / name).stat().st_mtime_ns)
        self.assertEqual({path.name: path.read_bytes() for path in self.assets.iterdir()}, source_files)
        self.assertFalse((self.model / '.verified.tmp').exists())
        self.network.assert_not_called()

    def test_missing_or_corrupt_part_removes_old_marker_without_network(self):
        data_entry = next(item for item in self.manifest['files'] if item['path'] == 'model.onnx.data')
        part = self.assets / data_entry['assets'][1]['name']
        original = part.read_bytes()
        for missing in (False, True):
            with self.subTest(missing=missing):
                self.seed_marker()
                if missing:
                    part.unlink(missing_ok=True)
                else:
                    # Same size catches a missing checksum validation.
                    part.write_bytes(b'x' * len(original))
                with self.assertRaisesRegex(ValueError, 'Missing or changed release asset'):
                    self.run_setup('--assets', str(self.assets))
                self.assert_no_marker()
                self.assertFalse((self.model / 'model.onnx.data').exists())
                part.write_bytes(original)
        self.network.assert_not_called()

    def test_individually_valid_parts_need_correct_combined_checksum(self):
        entry = next(item for item in self.manifest['files'] if item['path'] == 'model.onnx.data')
        entry['assets'] = list(reversed(entry['assets']))
        self.write_manifest()
        self.seed_marker()
        with self.assertRaisesRegex(ValueError, 'Combined model checksum failed'):
            self.run_setup('--assets', str(self.assets))
        self.assert_no_marker()
        self.assertFalse((self.model / 'model.onnx.data').exists())
        self.assertFalse((self.model / 'model.onnx.data.installing').exists())
        self.network.assert_not_called()

    def test_verify_only_rejects_missing_or_changed_files_and_never_downloads(self):
        self.seed_marker()
        with self.assertRaisesRegex(ValueError, 'Missing or changed model file'):
            self.run_setup('--verify-only')
        self.assert_no_marker()
        self.run_setup('--assets', str(self.assets))
        changed = self.model / 'tokenizer.json'
        changed.write_bytes(b'x' * len(self.contents['tokenizer.json']))
        with self.assertRaisesRegex(ValueError, 'Missing or changed model file'):
            self.run_setup('--verify-only')
        self.assert_no_marker()
        self.network.assert_not_called()

    def test_verify_only_success_hashes_present_files_and_refreshes_marker(self):
        self.model.mkdir()
        for name, content in self.contents.items():
            (self.model / name).write_bytes(content)
        self.run_setup('--verify-only')
        marker = json.loads((self.model / '.verified.json').read_text(encoding='utf-8'))
        self.assertEqual(marker['manifest_sha256'], sha256(self.manifest_path.read_bytes()))
        self.assertEqual(set(marker['files']), set(self.contents))
        self.network.assert_not_called()

    def test_manifest_rejects_path_traversal_in_files_and_parts_before_writing(self):
        for bad in ('../outside', '..\\outside', '/absolute', 'C:\\outside', '.', '..', 'file:stream'):
            for target in ('file', 'part'):
                with self.subTest(path=bad, target=target):
                    bad_manifest = copy.deepcopy(self.manifest)
                    if target == 'file':
                        bad_manifest['files'][0]['path'] = bad
                    else:
                        bad_manifest['files'][0]['assets'][0]['name'] = bad
                    with self.assertRaisesRegex(ValueError, 'Invalid model filename'):
                        installer.validate_manifest(bad_manifest)
        self.assertFalse(self.model.exists())
        self.network.assert_not_called()

    def test_manifest_rejects_wrong_source_duplicate_files_and_incomplete_parts(self):
        cases = []
        wrong_source = copy.deepcopy(self.manifest)
        wrong_source['release_base'] = 'https://example.invalid/models'
        cases.append(wrong_source)
        duplicate = copy.deepcopy(self.manifest)
        duplicate['files'].append(copy.deepcopy(duplicate['files'][0]))
        cases.append(duplicate)
        incomplete = copy.deepcopy(self.manifest)
        incomplete['files'][1]['assets'].pop()
        cases.append(incomplete)
        absent_required = copy.deepcopy(self.manifest)
        absent_required['files'].pop()
        cases.append(absent_required)
        wrong_checksum = copy.deepcopy(self.manifest)
        wrong_checksum['files'][0]['sha256'] = 'not-a-hash'
        cases.append(wrong_checksum)
        for manifest in cases:
            with self.subTest(manifest=manifest), self.assertRaises(ValueError):
                installer.validate_manifest(manifest)
        self.network.assert_not_called()

    def test_wrong_runtime_version_stops_before_installation(self):
        with patch.object(installer.importlib.metadata, 'version', return_value='0.0.0'):
            with self.assertRaisesRegex(ValueError, 'pinned requirements'):
                self.run_setup('--assets', str(self.assets))
        self.assertFalse(self.model.exists())
        self.network.assert_not_called()


if __name__ == '__main__':
    unittest.main()
