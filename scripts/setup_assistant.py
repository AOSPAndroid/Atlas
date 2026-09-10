"""Explicit optional setup: download GitHub release assets and verify every byte.

The normal Atlas launcher and assistant runtime never import or invoke this.
Use --assets DIR to install from files downloaded/transferred beforehand.
"""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import re
import shutil
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'assistant' / 'model-manifest.json'
MODEL = ROOT / 'models' / 'atlas-qwen3-4b'
CACHE = ROOT / 'data' / 'assistant-downloads'


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def valid(path, entry):
    return path.is_file() and path.stat().st_size == entry['size'] and digest(path) == entry['sha256']


def download(url, path, entry):
    if valid(path, entry):
        return
    temp = path.with_suffix(path.suffix + '.download')
    for attempt in range(3):
        try:
            offset = temp.stat().st_size if temp.exists() else 0
            if offset >= entry['size']:
                temp.unlink()
                offset = 0
            headers = {'User-Agent': 'Atlas-optional-assistant-setup'}
            if offset:
                headers['Range'] = f'bytes={offset}-'
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=120) as response:
                append = offset > 0 and response.status == 206
                with temp.open('ab' if append else 'wb') as output:
                    shutil.copyfileobj(response, output, 4 * 1024 ** 2)
            if not valid(temp, entry):
                temp.unlink(missing_ok=True)
                raise ValueError(f'Checksum mismatch for {path.name}')
            temp.replace(path)
            return
        except (OSError, ValueError):
            if attempt == 2:
                raise
            print('Retrying', path.name, flush=True)
            time.sleep(2)


def validate_manifest(manifest):
    if manifest.get('schema') != 1 or manifest.get('id') != 'atlas-qwen3-4b':
        raise ValueError('Unrecognised model manifest.')
    if not manifest['release_base'].startswith('https://github.com/AOSPAndroid/BAtlas/releases/download/'):
        raise ValueError('Unexpected model release source.')
    names = set()
    for entry in manifest['files']:
        for item, key in [(entry, 'path')] + [(part, 'name') for part in entry['assets']]:
            if not re.fullmatch(r'[A-Za-z0-9_.-]+', item[key]) or item[key] in ('.', '..'):
                raise ValueError('Invalid model filename.')
            if not re.fullmatch(r'[a-f0-9]{64}', item['sha256']) or not isinstance(item['size'], int) or item['size'] < 0:
                raise ValueError('Invalid model checksum or size.')
        if entry['path'] in names or sum(part['size'] for part in entry['assets']) != entry['size']:
            raise ValueError('Invalid model parts.')
        names.add(entry['path'])
    if (not {'genai_config.json', 'tokenizer.json', 'chat_template.jinja', 'LICENSE'} <= names
            or not any(name.endswith('.onnx') for name in names)
            or not any(name.endswith('.onnx.data') for name in names)):
        raise ValueError('Model manifest is incomplete.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', type=Path, help='Local folder of downloaded release assets (no model download)')
    parser.add_argument('--verify-only', action='store_true', help='Verify an already present model, without downloading')
    args = parser.parse_args()
    raw = MANIFEST.read_bytes()
    manifest = json.loads(raw)
    validate_manifest(manifest)
    required = manifest['runtime'].split('==')[1]
    if importlib.metadata.version('onnxruntime-genai') != required:
        raise ValueError('Install the pinned requirements-assistant.txt in .venv-assistant first.')
    import onnxruntime_genai  # Import only checks that native runtime dependencies load.
    MODEL.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    (MODEL / '.verified.json').unlink(missing_ok=True)
    for entry in manifest['files']:
        dest = MODEL / entry['path']
        print('Checking', entry['path'], flush=True)
        if valid(dest, entry):
            continue
        if args.verify_only:
            raise ValueError(f'Missing or changed model file: {entry["path"]}')
        parts = []
        for part in entry['assets']:
            local = (args.assets or CACHE) / part['name']
            if args.assets:
                if not valid(local, part):
                    raise ValueError(f'Missing or changed release asset: {part["name"]}')
            else:
                print('Downloading', part['name'], f'({part["size"] / 1024 ** 2:.0f} MiB)', flush=True)
                download(manifest['release_base'] + '/' + part['name'], local, part)
            parts.append(local)
        temp = dest.with_suffix(dest.suffix + '.installing')
        with temp.open('wb') as output:
            for part in parts:
                with part.open('rb') as source:
                    shutil.copyfileobj(source, output, 4 * 1024 ** 2)
        if not valid(temp, entry):
            temp.unlink(missing_ok=True)
            raise ValueError(f'Combined model checksum failed: {entry["path"]}')
        temp.replace(dest)
        if not args.assets:
            for part in parts:
                part.unlink()
    verified = {'manifest_sha256': hashlib.sha256(raw).hexdigest(), 'files': {
        entry['path']: {'size': (MODEL / entry['path']).stat().st_size,
                        'mtime_ns': (MODEL / entry['path']).stat().st_mtime_ns,
                        'sha256': entry['sha256']} for entry in manifest['files']}}
    marker = MODEL / '.verified.json'
    temporary = MODEL / '.verified.tmp'
    temporary.write_text(json.dumps(verified), encoding='utf-8')
    temporary.replace(marker)
    print('Offline assistant ready. In Atlas press Ctrl+K, then choose Ask Atlas.', flush=True)
    print('The model loads only after Ask. Machine scans still require their scan buttons.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        raise SystemExit('Assistant setup failed: ' + str(error))
