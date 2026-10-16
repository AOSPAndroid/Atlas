"""Read-only access to the folders the operator chose for the Assistant (notes, drafts, runbooks).

Only files inside those folders can be listed or read; paths are resolved first, so "..", links
and other drives are refused. Nothing is ever written, moved or deleted here.
"""
import html
import os
import re
import zipfile
from email import policy
from email.parser import BytesParser
from pathlib import Path

TEXT = {'.txt', '.md', '.markdown', '.log', '.csv', '.json', '.ps1', '.psm1', '.bat', '.cmd', '.xml', '.ini', '.cfg', '.yaml', '.yml', '.reg', '.sql', '.py'}
SUPPORTED = TEXT | {'.docx', '.pptx', '.xlsx', '.eml', '.html', '.htm', '.pdf'}
MAX_BYTES = 5 * 1024 * 1024
MAX_TEXT = 200000
MAX_FILES = 50000
# Folders that never hold your notes: system, recycle bin, program and tool folders, Atlas's own data.
SKIP_DIRS = {'$recycle.bin', 'system volume information', 'windows', 'program files', 'program files (x86)', 'programdata',
             'appdata', 'node_modules', '.git', '.svn', '__pycache__', 'venv', '.venv', 'site-packages', 'llm', 'drawio'}
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
    if suffix == '.xlsx':
        return _xlsx_text(path)
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


def _xlsx_text(path, sheets=10, rows=2000):
    """Cell text of the first sheets, one row per line, cells separated by tabs."""
    try:
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
            shared = []
            if 'xl/sharedStrings.xml' in names:
                for item in re.findall(r'<si>(.*?)</si>', archive.read('xl/sharedStrings.xml').decode('utf-8', 'replace'), re.S):
                    shared.append(html.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', item, re.S))))
            parts = []
            files = sorted((n for n in names if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', n)), key=lambda n: int(re.findall(r'\d+', n)[0]))
            for name in files[:sheets]:
                lines = []
                for row in re.findall(r'<row[^>]*>(.*?)</row>', archive.read(name).decode('utf-8', 'replace'), re.S)[:rows]:
                    cells = []
                    for attrs, body in re.findall(r'<c([^>]*)>(.*?)</c>', row, re.S):
                        value = re.search(r'<v>(.*?)</v>', body, re.S)
                        if 't="s"' in attrs and value:
                            index = int(value.group(1))
                            cells.append(shared[index] if index < len(shared) else '')
                        elif 't="inlineStr"' in attrs:
                            cells.append(html.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', body, re.S))))
                        elif value:
                            cells.append(html.unescape(value.group(1)))
                    if any(c.strip() for c in cells):
                        lines.append('\t'.join(cells))
                parts.append('\n'.join(lines))
            return '\n\n'.join(p for p in parts if p)
    except (zipfile.BadZipFile, KeyError, ValueError) as error:
        raise FileError(f'{path.name} could not be opened as an Excel file.') from error


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


def every_file(config, limit=None):
    """Supported files in the chosen folders, skipping system and program folders, up to the limit."""
    limit = limit or int((config.get('assistant') or {}).get('max_files') or MAX_FILES)
    found = []
    for root in folders(config):
        stack = [root]
        while stack and len(found) < limit:
            folder = stack.pop()
            try:
                entries = list(os.scandir(folder))
            except OSError:
                continue  # no access: skip quietly
            for entry in entries:
                name = entry.name
                if name.startswith(('.', '~$')):
                    continue
                try:
                    if entry.is_dir(follow_symlinks=False):
                        if name.casefold() not in SKIP_DIRS:
                            stack.append(entry.path)
                    elif Path(name).suffix.lower() in SUPPORTED and entry.is_file(follow_symlinks=False):
                        stat = entry.stat()
                        if 0 < stat.st_size <= MAX_BYTES:
                            found.append((entry.path, f'{stat.st_mtime_ns}:{stat.st_size}', stat.st_mtime_ns))
                            if len(found) >= limit:
                                break
                except OSError:
                    continue
    return found


class FileSource:
    """Search index source that only reads files that are new or changed (see search_index.SearchIndex)."""
    background = True

    def __init__(self, config):
        self.config = config

    def listing(self):
        return {path: signature for path, signature, _ in every_file(self.config)}

    def row(self, path):
        item = read(self.config, path)
        return {'ref': item['path'], 'title': item['name'], 'body': item['text'][:50000],
                'at': _iso(int(item['modified'] * 1e9)), 'extra': {'folder': str(Path(item['path']).parent)}}


def _iso(nanoseconds):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(nanoseconds / 1e9, timezone.utc).isoformat()
