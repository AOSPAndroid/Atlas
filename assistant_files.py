"""Read-only access to the folders the operator chose for the Assistant (notes, drafts, runbooks).

Only files inside those folders can be listed or read; paths are resolved first, so "..", links
and other drives are refused. Nothing is ever written, moved or deleted here.
"""
import html
import re
import zipfile
from email import policy
from email.parser import BytesParser
from pathlib import Path

TEXT = {'.txt', '.md', '.markdown', '.log', '.csv', '.json', '.ps1', '.psm1', '.bat', '.cmd', '.xml', '.ini', '.cfg', '.yaml', '.yml', '.reg', '.sql', '.py'}
SUPPORTED = TEXT | {'.docx', '.pptx', '.eml', '.html', '.htm', '.pdf'}
MAX_BYTES = 5 * 1024 * 1024
MAX_TEXT = 200000
MAX_FILES = 3000
_cache = {}


class FileError(Exception):
    pass


def folders(config):
    """Configured folders that exist, as resolved paths."""
    result = []
    for value in (config.get('assistant') or {}).get('folders') or []:
        try:
            path = Path(str(value)).expanduser().resolve()
        except (OSError, RuntimeError):
            continue
        if path.is_dir() and path not in result:
            result.append(path)
    return result


def resolve(config, value):
    """A path inside one of the chosen folders, or FileError."""
    allowed = folders(config)
    if not allowed:
        raise FileError('Choose a notes folder in Assistant settings first.')
    try:
        path = Path(str(value or '')).expanduser().resolve()
    except (OSError, RuntimeError) as error:
        raise FileError('That path cannot be read.') from error
    if not any(path == root or root in path.parents for root in allowed):
        raise FileError('Only files in your chosen Assistant folders can be read.')
    return path


def listing(config, value=''):
    """Folders and supported files in one folder (the chosen folders themselves when value is empty)."""
    if not value:
        return {'path': '', 'parent': None, 'items': [{'name': str(p), 'path': str(p), 'folder': True} for p in folders(config)]}
    path = resolve(config, value)
    if not path.is_dir():
        raise FileError('That folder no longer exists.')
    items = []
    try:
        entries = sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.casefold()))
    except OSError as error:
        raise FileError(f'Cannot open {path.name}: {error.strerror or error}') from error
    for entry in entries[:1000]:
        try:
            if entry.name.startswith(('.', '~$')):
                continue
            if entry.is_dir():
                items.append({'name': entry.name, 'path': str(entry), 'folder': True})
            elif entry.suffix.lower() in SUPPORTED:
                stat = entry.stat()
                items.append({'name': entry.name, 'path': str(entry), 'folder': False, 'size': stat.st_size, 'modified': stat.st_mtime})
        except OSError:
            continue
    parent = None if path in folders(config) else str(path.parent)
    return {'path': str(path), 'parent': parent, 'items': items}


def _xml_text(data, paragraph):
    data = re.sub(rf'</{paragraph}>', '\n', data)
    data = re.sub(r'<w:tab/>|<a:tab/>', '\t', data)
    return html.unescape(re.sub(r'<[^>]+>', '', data))


def extract(path):
    """Plain text of a supported file."""
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED:
        raise FileError(f'{path.suffix or "This"} files are not supported. Save it as .txt, .md or .docx.')
    if path.stat().st_size > MAX_BYTES:
        raise FileError(f'{path.name} is larger than 5 MB.')
    if suffix in TEXT:
        raw = path.read_bytes()
        for encoding in ('utf-8-sig', 'utf-16') if raw[:2] in (b'\xff\xfe', b'\xfe\xff') else ('utf-8-sig', 'cp1252'):
            try:
                return raw.decode(encoding)
            except UnicodeDecodeError:
                continue
        return raw.decode('utf-8', 'replace')
    if suffix in ('.html', '.htm'):
        text = path.read_text(encoding='utf-8', errors='replace')
        text = re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', ' ', text)
        text = re.sub(r'(?i)<br\s*/?>|</p>|</div>|</li>|</h\d>|</tr>', '\n', text)
        return html.unescape(re.sub(r'<[^>]+>', '', text))
    if suffix == '.eml':
        message = BytesParser(policy=policy.default).parsebytes(path.read_bytes())
        body = message.get_body(preferencelist=('plain', 'html'))
        content = body.get_content() if body else ''
        if body is not None and body.get_content_type() == 'text/html':
            content = html.unescape(re.sub(r'<[^>]+>', ' ', re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', ' ', content)))
        return f"From: {message.get('from', '')}\nSubject: {message.get('subject', '')}\nDate: {message.get('date', '')}\n\n{content}"
    if suffix in ('.docx', '.pptx'):
        try:
            with zipfile.ZipFile(path) as archive:
                if suffix == '.docx':
                    return _xml_text(archive.read('word/document.xml').decode('utf-8', 'replace'), 'w:p')
                slides = sorted((n for n in archive.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml', n)), key=lambda n: int(re.findall(r'\d+', n)[0]))
                return '\n\n'.join(_xml_text(archive.read(n).decode('utf-8', 'replace'), 'a:p') for n in slides)
        except (zipfile.BadZipFile, KeyError) as error:
            raise FileError(f'{path.name} could not be opened as a Word or PowerPoint file.') from error
    try:
        from pypdf import PdfReader
    except ImportError as error:
        raise FileError('Reading PDF files needs the pypdf package: pip install pypdf') from error
    try:
        return '\n\n'.join(page.extract_text() or '' for page in PdfReader(str(path)).pages[:200])
    except Exception as error:  # pypdf raises many types for damaged files
        raise FileError(f'{path.name} could not be read as a PDF.') from error


def read(config, value):
    path = resolve(config, value)
    if not path.is_file():
        raise FileError('That file no longer exists.')
    stat = path.stat()
    key = (str(path), stat.st_mtime_ns, stat.st_size)
    if key not in _cache:
        try:
            text = extract(path)
        except OSError as error:
            raise FileError(f'Cannot read {path.name}: {error.strerror or error}') from error
        text = re.sub(r'\n{3,}', '\n\n', text.replace('\r\n', '\n')).strip()
        if len(_cache) > 500:
            _cache.clear()
        _cache[key] = text
    text = _cache[key]
    return {'path': str(path), 'name': path.name, 'text': text[:MAX_TEXT], 'truncated': len(text) > MAX_TEXT, 'modified': stat.st_mtime}


def every_file(config):
    """Supported files in the chosen folders, newest first, for the search index."""
    found = []
    for root in folders(config):
        for path in root.rglob('*'):
            if len(found) >= MAX_FILES:
                break
            try:
                if path.suffix.lower() in SUPPORTED and path.is_file() and not path.name.startswith(('.', '~$')) and path.stat().st_size <= MAX_BYTES:
                    found.append(path)
            except OSError:
                continue
    return found


def search_source(config):
    """(signature, rows) for search_index: one entry per readable file."""
    files = every_file(config)
    signature = []
    for path in files:
        try:
            stat = path.stat()
            signature.append((str(path), stat.st_mtime_ns, stat.st_size))
        except OSError:
            continue
    rows = []
    for path, modified, _ in signature:
        try:
            item = read(config, path)
        except (FileError, OSError):
            continue
        rows.append({'ref': path, 'title': item['name'], 'body': item['text'][:50000],
                     'at': _iso(modified), 'extra': {'folder': str(Path(path).parent)}})
    import hashlib
    return hashlib.sha256(repr(signature).encode()).hexdigest(), rows


def _iso(nanoseconds):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(nanoseconds / 1e9, timezone.utc).isoformat()
