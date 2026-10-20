"""Read a visual desk plan (the assistants' Excel) into seating rows.

The plan is drawn, not tabulated: each box holds a label and a desk code such as
"Christophe Duriez 02R015079", "Credit Sales 02R016079" or "Open 03R016079", in one cell or in
cells stacked above the code. Every sheet is scanned; sheets without desk codes are ignored.
Labels become: a person (exactly one directory match), a vacant desk (Open/Vacant/blank), or
otherwise a team or room label shown as-is. Nothing here writes to the database.
"""
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from pathlib import Path

from directory_workbook import col_idx, iter_rows, workbook_parts, workbook_scope

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
# Floor (1-2 digits), R, six digits. A missing leading zero ("2R017069") is a common typo.
CODE = re.compile(r'(?<![0-9A-Za-z])([0-9]{1,2})\s?R\s?([0-9]{6})(?![0-9])', re.I)
VACANT = {'', 'open', 'vacant', 'free', 'libre', 'available', 'empty', 'spare', 'hot desk', 'hotdesk', 'flex', 'flex desk'}
MAX_ABOVE = 3


def plain(text):
    text = unicodedata.normalize('NFKD', str(text or ''))
    return ''.join(ch for ch in text if not unicodedata.combining(ch)).casefold()


def name_key(text):
    """Order-free: "DURIEZ Christophe" and "Christophe Duriez" give the same key."""
    words = re.findall(r'[a-z]+', plain(re.sub(r'\([^)]*\)', ' ', text)))
    return ' '.join(sorted(words))


def tidy(text):
    return re.sub(r'\s+', ' ', str(text or '')).strip(' -–·,;:')


def merged_ranges(path, part):
    """Top-left cell for every cell inside a merged range: {(row, col): (row, col)}."""
    owners = {}
    with zipfile.ZipFile(path) as book:
        with book.open(part) as sheet:
            for _, element in ET.iterparse(sheet):
                if element.tag == NS + 'mergeCell':
                    ref = element.attrib.get('ref', '')
                    if ':' not in ref:
                        continue
                    first, last = ref.split(':')
                    (r1, c1), (r2, c2) = cell_ref(first), cell_ref(last)
                    if (r2 - r1 + 1) * (c2 - c1 + 1) > 400:
                        continue
                    for r in range(r1, r2 + 1):
                        for c in range(c1, c2 + 1):
                            owners[(r, c)] = (r1, c1)
                elif element.tag == NS + 'row':
                    element.clear()
    return owners


def cell_ref(ref):
    match = re.fullmatch(r'([A-Z]{1,3})([0-9]+)', ref)
    return int(match[2]), col_idx(ref)


def sheet_boxes(path, sheet, part):
    """(desk code as written, label text, cell) for every desk code on one sheet."""
    grid = {(number, index): value for number, row in iter_rows(path, part) for index, value in enumerate(row) if value}
    if not any(CODE.search(value) for value in grid.values()):
        return []
    owners = merged_ranges(path, part)

    def value(r, c):
        return grid.get(owners.get((r, c), (r, c)), '')

    found = []
    for (r, c), text in sorted(grid.items()):
        matches = list(CODE.finditer(text))
        start = 0
        for match in matches:
            label = text[start:match.start()]
            start = match.end()
            if not tidy(label) and match is matches[0]:
                # Label in the cells above (stacked or merged), within the same box.
                parts, row, seen = [], r - 1, set()
                while row >= 1 and len(parts) < MAX_ABOVE:
                    above = value(row, c)
                    owner = owners.get((row, c), (row, c))
                    if not above or CODE.search(above):
                        break
                    if owner not in seen:
                        seen.add(owner)
                        parts.insert(0, above)
                    row -= 1
                label = ' '.join(parts)
            found.append((match.group(0), match.group(1), match.group(2), tidy(label), f'{sheet}!{column_name(c)}{r}'))
    return found


def column_name(index):
    name, index = '', index + 1
    while index:
        index, rest = divmod(index - 1, 26)
        name = chr(65 + rest) + name
    return name


class Matcher:
    """Plan name -> one directory person, or None. In order:
    exact (word order, case, accents ignored); the same with several people, one of them in Paris;
    a shorter plan name ("Sandrine Kone" for "Sandrine Kone Penali"); a near-identical spelling
    ("Ons Belkicir" for "Ons Belkecir") of someone in Paris with no close second. Nothing else is guessed."""

    def __init__(self, c):
        self.exact, self.words, self.people = defaultdict(list), defaultdict(set), []
        columns = {row[1] for row in c.execute('pragma table_info(users)')}
        location = 'location' if 'location' in columns else "''"
        for canonical, login, email, name, place in c.execute(f'select canonical_key,user_id,email,full_name,{location} from users'):
            if not name:
                continue
            index = len(self.people)
            place = plain(place)
            self.people.append((canonical, login or email or canonical, name, 'paris' in place or 'hoche' in place))
            self.exact[name_key(name)].append(index)
            for word in set(name_key(name).split()):
                self.words[word].add(index)
        self.paris = [i for i, person in enumerate(self.people) if person[3]]
        self.paris_names = [name_key(self.people[i][2]) for i in self.paris]

    def local(self, found):
        return {i for i in found if self.people[i][3]}

    def find(self, label):
        key = name_key(label)
        words = key.split()
        if not words:
            return None
        exact = set(self.exact.get(key, ()))
        if len(exact) == 1:
            return self.people[exact.pop()] + ('exact',)
        if len(exact) > 1:
            paris = self.local(exact)
            return self.people[paris.pop()] + ('paris',) if len(paris) == 1 else None
        if len(words) < 2 or any(len(word) < 2 for word in words):
            return None
        fuller = set.intersection(*(self.words.get(word, set()) for word in words))
        if len(fuller) > 1:
            fuller = self.local(fuller)
        if len(fuller) == 1:
            return self.people[fuller.pop()] + ('fuller',)
        if fuller:
            return None
        try:
            from rapidfuzz import fuzz, process
        except ImportError:
            return None
        best = process.extract(key, self.paris_names, scorer=fuzz.ratio, limit=2)
        if best and best[0][1] >= 90 and (len(best) == 1 or best[0][1] - best[1][1] >= 15):
            return self.people[self.paris[best[0][2]]] + ('spelling',)
        return None


@workbook_scope
def read_plan(path, c, known_desks=None):
    """Seating rows plus what the reader fixed or could not place."""
    path = Path(path)
    matcher = Matcher(c)
    matched_partly = []
    rows, by_desk, fixes, conflicts, unknown, sheets, not_found = [], {}, [], [], [], {}, []
    with zipfile.ZipFile(path) as book:
        if sum(item.file_size for item in book.infolist()) > 200 * 1024 * 1024:
            raise ValueError('The plan workbook expands beyond 200 MB.')
    for sheet, part in workbook_parts(path):
        boxes = sheet_boxes(path, sheet, part)
        if boxes:
            sheets[sheet] = len(boxes)
        for written, floor, digits, label, cell in boxes:
            desk = f'{int(floor):02d}R{digits}'
            if written.upper().replace(' ', '') != desk:
                fixes.append({'cell': cell, 'written': written, 'desk': desk})
            if known_desks is not None and desk not in known_desks:
                unknown.append({'cell': cell, 'desk': desk, 'label': label})
                continue
            if desk in by_desk:
                if plain(by_desk[desk]['_label']) != plain(label):
                    conflicts.append({'desk': desk, 'cells': [by_desk[desk]['_cell'], cell], 'labels': [by_desk[desk]['_label'], label]})
                continue
            row = {'desk': desk, '_cell': cell, '_label': label, '_row': cell}
            words = plain(label)
            if words in VACANT or re.fullmatch(r'(open|vacant|free|libre)\b.*', words):
                row.update(name='', status='vacant', kind='vacant')
            else:
                person = matcher.find(label)
                if person and person[4] != 'exact':
                    matched_partly.append({'desk': desk, 'name': label, 'directory': person[2], 'account': person[1], 'how': person[4]})
                if person:
                    canonical, account = person[0], person[1]
                    # The map keeps its own team names (Credit, Markets...), so no team is set here.
                    row.update(name=label[:160], account=account, status='assigned', kind='person', canonical=canonical)
                else:
                    # A team, room or someone not in the directory: shown exactly as written.
                    row.update(name=label[:160], status='unconfirmed', kind='label')
                    if re.fullmatch(r"[A-Za-zÀ-ÿ'’-]+(?: [A-Za-zÀ-ÿ'’-]+){1,3}", re.sub(r'\([^)]*\)', '', label).strip()):
                        not_found.append({'desk': desk, 'name': label, 'ambiguous': len(matcher.exact.get(name_key(label), ())) > 1})
            by_desk[desk] = row
            rows.append(row)
    if not rows:
        raise ValueError('No desk codes (like 02R015079) were found in this workbook.')
    # Repeated labels ("Credit Sales") and known team names are teams, not missing people.
    repeats = defaultdict(int)
    for row in rows:
        repeats[plain(row['_label'])] += 1
    teams = {plain(d) for (d,) in c.execute("select distinct department from users where department<>''")}
    teams |= {plain((record or {}).get('team', '')) for record in (known_desks or {}).values()} if isinstance(known_desks, dict) else set()
    not_found = [item for item in not_found if item['ambiguous'] or (repeats[plain(item['name'])] == 1 and plain(item['name']) not in teams)]
    return {'rows': rows, 'fixes': fixes, 'conflicts': conflicts, 'unknown_desks': unknown, 'sheets': sheets,
            'not_in_directory': not_found, 'matched_partly': matched_partly}
