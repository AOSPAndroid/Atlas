"""Build reproducible assets from pinned ONNX weights and their original license.

Maintainer command only. Atlas never invokes this script or downloads models.
Weights remain outside Git; release assets are split below GitHub's size limit.
"""
import hashlib
import json
from pathlib import Path
import re
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REPO = 'onnx-community/Qwen3-4B-ONNX'
REVISION = '98ddba15d05dede4435afb63f13280abcdbc2a48'
SUBDIR = 'onnxruntime/cpu_and_mobile/cpu-int4-kld-block-128/'
LICENSE_REPO = 'Qwen/Qwen3-4B'
LICENSE_REVISION = '1cfa9a7208912126459214e8b04321603b3df60c'
TAG = 'atlas-assistant-qwen3-4b-v1'
MODEL_ID = 'atlas-qwen3-4b'
CHUNK = 1024 ** 3


def digest(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def catalogue(repo, revision):
    url = f'https://huggingface.co/api/models/{repo}/revision/{revision}?blobs=true'
    with urllib.request.urlopen(url, timeout=60) as response:
        upstream = json.load(response)
    if upstream.get('sha') != revision:
        raise ValueError('Upstream revision did not match the pinned model source.')
    return upstream['siblings']


def matches_upstream(path, entry):
    """Verify both large LFS objects and small ordinary Git blobs."""
    if not path.is_file() or path.stat().st_size != entry['size']:
        return False
    expected = entry.get('lfs', {}).get('sha256')
    if expected:
        return digest(path) == expected
    checksum = hashlib.sha1(f"blob {entry['size']}\0".encode('ascii'))
    with path.open('rb') as source:
        while block := source.read(8 * 1024 ** 2):
            checksum.update(block)
    return checksum.hexdigest() == entry['blobId']


def main():
    assets = ROOT / 'data' / 'assistant-release-qwen3'
    model = ROOT / 'models' / MODEL_ID
    assets.mkdir(parents=True, exist_ok=True)
    model.mkdir(parents=True, exist_ok=True)
    sources = []
    for entry in catalogue(REPO, REVISION):
        if entry['rfilename'].startswith(SUBDIR) and not entry['rfilename'].endswith('.py'):
            sources.append((entry['rfilename'][len(SUBDIR):], REPO, REVISION, entry))
    legal = catalogue(LICENSE_REPO, LICENSE_REVISION)
    # The ONNX export references the base model but does not include its license.
    # Preserve original legal files without editing their copyright notices.
    for entry in legal:
        if entry['rfilename'] in ('LICENSE', 'NOTICE'):
            sources.append((entry['rfilename'], LICENSE_REPO, LICENSE_REVISION, entry))
    if not any(name == 'LICENSE' for name, *_ in sources):
        raise ValueError('The pinned original model license is missing.')
    sources.sort(key=lambda item: item[0])
    files = []
    names = set()
    for name, repo, revision, entry in sources:
        source = entry['rfilename']
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', name) or name in ('.', '..') or name in names:
            raise ValueError('Unexpected or duplicated model filename')
        names.add(name)
        dest = model / name
        if not matches_upstream(dest, entry):
            print('Downloading', name, entry['size'], 'bytes', flush=True)
            temporary = dest.with_suffix(dest.suffix + '.download')
            with urllib.request.urlopen(f'https://huggingface.co/{repo}/resolve/{revision}/{source}', timeout=120) as response, temporary.open('wb') as output:
                downloaded = 0
                while block := response.read(8 * 1024 ** 2):
                    output.write(block)
                    downloaded += len(block)
                    if downloaded % (256 * 1024 ** 2) == 0:
                        print(f'  {downloaded / 1024 ** 2:.0f} MiB', flush=True)
            if not matches_upstream(temporary, entry):
                raise ValueError(f'Upstream verification failed: {name}')
            temporary.replace(dest)
        file_hash = digest(dest)
        combined = hashlib.sha256()
        parts = []
        with dest.open('rb') as incoming:
            index = 0
            while incoming.tell() < dest.stat().st_size:
                index += 1
                asset_name = name if dest.stat().st_size <= CHUNK else f'{name}.part{index:02d}'
                asset = assets / asset_name
                remaining = min(CHUNK, dest.stat().st_size - incoming.tell())
                with asset.open('wb') as output:
                    while remaining:
                        block = incoming.read(min(8 * 1024 ** 2, remaining))
                        if not block:
                            raise ValueError(f'Model file changed while packaging: {name}')
                        output.write(block)
                        combined.update(block)
                        remaining -= len(block)
                parts.append({'name': asset_name, 'size': asset.stat().st_size, 'sha256': digest(asset)})
        if combined.hexdigest() != file_hash:
            raise ValueError(f'Model file changed while packaging: {name}')
        files.append({'path': name, 'size': dest.stat().st_size, 'sha256': file_hash, 'assets': parts})
        print('Verified and packaged', name, flush=True)
    manifest = {'schema': 1, 'id': MODEL_ID, 'name': 'Qwen3 4B · CPU int4 KLD',
                'upstream': REPO, 'revision': REVISION, 'license': 'Apache-2.0',
                'license_source': {'upstream': LICENSE_REPO, 'revision': LICENSE_REVISION,
                                   'path': 'LICENSE', 'sha256': digest(model / 'LICENSE')},
                'release_tag': TAG,
                'release_base': f'https://github.com/AOSPAndroid/BAtlas/releases/download/{TAG}',
                'runtime': 'onnxruntime-genai==0.15.2', 'files': files}
    text = json.dumps(manifest, indent=2) + '\n'
    (ROOT / 'assistant').mkdir(exist_ok=True)
    (ROOT / 'assistant' / 'model-manifest.json').write_text(text, encoding='utf-8', newline='\n')
    (assets / 'model-manifest.json').write_text(text, encoding='utf-8', newline='\n')
    # The release LICENSE remains byte-exact; normalize only the tracked text
    # copy so Windows checkout settings cannot change the Linux rebuild diff.
    (ROOT / 'assistant' / 'MODEL-LICENSE.txt').write_text(
        (model / 'LICENSE').read_text(encoding='utf-8'), encoding='utf-8', newline='\n')
    print('Release assets ready:', assets, flush=True)


if __name__ == '__main__':
    main()
