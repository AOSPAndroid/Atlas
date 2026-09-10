"""Explicit optional setup: download pinned model files and verify every byte.

The normal Atlas launcher and assistant runtime never import or invoke this.
Use --assets DIR to install from files downloaded/transferred beforehand.
Private release downloads fall back to the identical pinned public upstream files.
"""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import re
import shutil
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'assistant' / 'model-manifest.json'
MODEL = ROOT / 'models' / 'atlas-qwen3-4b'
CACHE = ROOT / 'data' / 'assistant-downloads'
UPSTREAM = 'onnx-community/Qwen3-4B-ONNX'
UPSTREAM_FOLDER = 'onnxruntime/cpu_and_mobile/cpu-int4-kld-block-128'
MODEL_FILES = {'LICENSE', 'chat_template.jinja', 'config.json', 'genai_config.json',
               'model.onnx', 'model.onnx.data', 'tokenizer.json', 'tokenizer_config.json'}


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
        except (OSError, ValueError) as error:
            # Access failures cannot improve by retrying the same anonymous URL.
            if isinstance(error, urllib.error.HTTPError) and error.code in (403, 404):
                raise
            if attempt == 2:
                raise
            print('Retrying', path.name, flush=True)
            time.sleep(2)


def validate_manifest(manifest):
    if manifest.get('schema') != 1 or manifest.get('id') != 'atlas-qwen3-4b':
        raise ValueError('Unrecognised model manifest.')
    if not re.fullmatch(r'https://github.com/AOSPAndroid/BAtlas/releases/download/[A-Za-z0-9_-][A-Za-z0-9_.-]*', manifest['release_base']):
        raise ValueError('Unexpected model release source.')
    if manifest.get('upstream') != UPSTREAM or not re.fullmatch(r'[a-f0-9]{40}', manifest.get('revision', '')):
        raise ValueError('Unexpected or unpinned upstream model source.')
    license_source = manifest.get('license_source', {})
    if (not isinstance(license_source, dict)
            or license_source.get('upstream') != 'Qwen/Qwen3-4B'
            or not re.fullmatch(r'[a-f0-9]{40}', license_source.get('revision', ''))
            or license_source.get('path') != 'LICENSE'
            or not re.fullmatch(r'[a-f0-9]{64}', license_source.get('sha256', ''))):
        raise ValueError('Unexpected or unpinned license source.')
    names = set()
    for entry in manifest['files']:
        for item, key in [(entry, 'path')] + [(part, 'name') for part in entry['assets']]:
            if not re.fullmatch(r'[A-Za-z0-9_.-]+', item[key]) or item[key] in ('.', '..'):
                raise ValueError('Invalid model filename.')
            if not re.fullmatch(r'[a-f0-9]{64}', item['sha256']) or not isinstance(item['size'], int) or item['size'] < 0:
                raise ValueError('Invalid model checksum or size.')
        if entry['path'] in names or sum(part['size'] for part in entry['assets']) != entry['size']:
            raise ValueError('Invalid model parts.')
        if entry['path'] not in MODEL_FILES:
            raise ValueError('Unexpected upstream model filename.')
        if entry['path'] == 'LICENSE' and entry['sha256'] != license_source['sha256']:
            raise ValueError('License source checksum does not match the model manifest.')
        names.add(entry['path'])
    if (not {'genai_config.json', 'tokenizer.json', 'chat_template.jinja', 'LICENSE'} <= names
            or not any(name.endswith('.onnx') for name in names)
            or not any(name.endswith('.onnx.data') for name in names)):
        raise ValueError('Model manifest is incomplete.')


def upstream_url(manifest, entry):
    # The manifest is validated before any download. No mutable branch or arbitrary
    # URL is accepted; whole upstream files must match the release's exact checksum.
    if entry['path'] == 'LICENSE':
        source = manifest['license_source']
        return f'https://huggingface.co/{source["upstream"]}/resolve/{source["revision"]}/LICENSE'
    return f'https://huggingface.co/{manifest["upstream"]}/resolve/{manifest["revision"]}/{UPSTREAM_FOLDER}/{entry["path"]}'


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
    release_requires_access = False
    for entry in manifest['files']:
        dest = MODEL / entry['path']
        print('Checking', entry['path'], flush=True)
        if valid(dest, entry):
            continue
        if args.verify_only:
            raise ValueError(f'Missing or changed model file: {entry["path"]}')
        parts = []
        if not release_requires_access or args.assets:
            try:
                for part in entry['assets']:
                    local = (args.assets or CACHE) / part['name']
                    if args.assets:
                        if not valid(local, part):
                            raise ValueError(f'Missing or changed release asset: {part["name"]}')
                    else:
                        print('Downloading', part['name'], f'({part["size"] / 1024 ** 2:.0f} MiB)', flush=True)
                        download(manifest['release_base'] + '/' + part['name'], local, part)
                    parts.append(local)
            except urllib.error.HTTPError as error:
                if args.assets or error.code not in (403, 404):
                    raise
                release_requires_access = True
        temp = dest.with_suffix(dest.suffix + '.installing')
        if release_requires_access and not args.assets:
            print('Release download requires access; using checksum-verified pinned upstream file', entry['path'], flush=True)
            download(upstream_url(manifest, entry), temp, entry)
        else:
            with temp.open('wb') as output:
                for part in parts:
                    with part.open('rb') as source:
                        shutil.copyfileobj(source, output, 4 * 1024 ** 2)
        if not valid(temp, entry):
            temp.unlink(missing_ok=True)
            raise ValueError(f'Combined model checksum failed: {entry["path"]}')
        temp.replace(dest)
        if not args.assets:
            # Include cached/resumable parts left before a release-access failure.
            for part in entry['assets']:
                cached = CACHE / part['name']
                cached.unlink(missing_ok=True)
                cached.with_suffix(cached.suffix + '.download').unlink(missing_ok=True)
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
