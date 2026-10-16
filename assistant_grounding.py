"""Checks that keep a small local model honest.

The model only rewrites text it was given. Every item it returns carries a quote from that text,
and this module verifies, in code, that the quote really is there and that the specifics in the
item (machine names, numbers, error codes, paths, commands, addresses) appear in the sources.
Nothing here calls the model; it is plain string matching, so it is fast and testable.
"""
import re
import unicodedata

from rapidfuzz import fuzz

# Specifics a model must never invent. Each pattern finds one kind of checkable detail.
SPECIFICS = [
    ('address', re.compile(r'[\w.%+-]+@[\w-]+(?:\.[\w-]+)+')),
    ('link', re.compile(r'https?://[^\s<>"\')\]]+')),
    ('path', re.compile(r'(?:\\\\[\w.$-]+(?:\\[^\s\\"<>|]+)+|\b[A-Za-z]:\\[^\s"<>|]*)')),
    ('address', re.compile(r'\b\d{1,3}(?:\.\d{1,3}){3}\b')),
    # Group and share names in capitals: GRP-VPN-USERS, SG_APP_ADOBE.
    ('name', re.compile(r'(?<![\w-])[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)+(?![\w-])')),
    # Letters and digits together: machine names (LT-PAR-0042, PC123), tickets (INC-12345), error codes (0x80070005).
    ('name', re.compile(r'(?<![\w-])(?=[A-Za-z0-9-]*\d)(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*(?![\w-])')),
    ('number', re.compile(r'(?<![\w.])\d+(?:[.,:]\d+)*(?![\w])')),
]
STOP = set('''the and for with that this from your have will into when then than them they what which where while been were
are was not but can could should would also just only each more most some such very there their about after before over
under again once both same other into onto upon les des une est pour dans avec sur pas que qui par plus vous nous
check checks step steps make sure please open close using user users issue problem fix fixed'''.split())
WORD = re.compile(r'[^\W\d_]{4,}')


def normalize(text):
    """Comparable text: same letters whatever the quotes, dashes, accents, case or line breaks."""
    text = unicodedata.normalize('NFKC', str(text or ''))
    text = text.translate({0x2018: "'", 0x2019: "'", 0x201C: '"', 0x201D: '"', 0x2013: '-', 0x2014: '-', 0x00A0: ' '})
    text = ''.join(c for c in unicodedata.normalize('NFKD', text) if not unicodedata.combining(c))
    return ' '.join(text.casefold().split())


def quote_status(quote, sources):
    """'exact' if the quote is in a source, 'close' for small OCR/typing differences, else None."""
    wanted = normalize(quote).strip(' .,;:"\'')
    if len(wanted) < 3:
        return None
    joined = [normalize(s) for s in sources]
    if any(wanted in s for s in joined):
        return 'exact'
    if len(wanted) >= 12 and any(fuzz.partial_ratio(wanted, s, score_cutoff=92) for s in joined if s):
        return 'close'
    return None


def specifics(text):
    """The checkable details in a piece of text, as (kind, value) pairs, without duplicates."""
    found, taken = [], []
    plain = str(text or '')
    for kind, pattern in SPECIFICS:
        for match in pattern.finditer(plain):
            start, end = match.span()
            if any(s <= start and end <= e for s, e in taken):
                continue  # already part of a longer detail (a number inside a path or a name)
            value = match.group(0).rstrip('.,;:')
            if kind == 'number' and len(value) == 1:
                continue  # "1." step numbers and single digits carry no risk
            taken.append((start, end))
            if (kind, value) not in found:
                found.append((kind, value))
    return found


def _present(value, joined):
    value = normalize(value)
    if not value:
        return True
    pattern = r'(?<![\w])' + re.escape(value) + r'(?![\w])' if value[0].isalnum() and value[-1].isalnum() else re.escape(value)
    return re.search(pattern, joined) is not None


def missing_specifics(text, sources):
    """Details in text that appear in none of the sources: the usual signs of a made-up answer."""
    joined = '\n'.join(normalize(s) for s in sources)
    return [value for _, value in specifics(text) if not _present(value, joined)]


def _stems(text):
    return {w[:5] for w in WORD.findall(normalize(text)) if w not in STOP}


def word_support(text, sources):
    """Share of the meaningful words in text that also occur (by stem) in the sources."""
    words = _stems(text)
    if not words:
        return 1.0
    known = set().union(*(_stems(s) for s in sources)) if sources else set()
    return len(words & known) / len(words)


def check_item(text, quote, sources, *, min_support=0.5, min_tie=0.0):
    """Verify one generated item. Returns (ok, reasons, quote status) with plain-language reasons.

    min_tie: share of the item's words that must come from its own quote, so a true quote cannot
    vouch for an unrelated sentence."""
    reasons = []
    status = quote_status(quote, sources) if quote else None
    if not status:
        reasons.append('its supporting quote is not in the source')
    elif min_tie and word_support(text, [quote]) < min_tie:
        reasons.append('it says more than the words it quotes')
    missing = missing_specifics(text, sources)
    if missing:
        reasons.append('not in the source: ' + ', '.join(missing[:5]))
    if word_support(text, sources) < min_support:
        reasons.append('mostly words that are not in the source')
    return not reasons, reasons, status


def command_in_notes(command, sources):
    """The line from the notes that a garbled command was copied from, word for word, or ''.

    Small models sometimes mangle backslashes or quotes when copying. The notes' own line is used
    instead; the model's version is never trusted."""
    wanted = normalize(command).strip('`')
    if len(wanted) < 6:
        return ''
    best, score = '', 0
    for source in sources:
        for line in str(source or '').splitlines():
            line = re.sub(r'^\s*(?:[-*>$#]|\d+[.)]|ran:|run:|cmd:)\s*', '', line.strip(), flags=re.I).strip('`').strip()
            candidate = normalize(line)
            if not candidate or candidate.split()[0] != wanted.split()[0]:
                continue  # never swap one command for a different one
            value = fuzz.ratio(wanted, candidate)
            if value > score:
                best, score = line, value
    return best if score >= 85 else ''


def command_found(command, sources):
    """Commands must appear as written (spacing and case aside), never reconstructed."""
    wanted = normalize(command).strip('`')
    return bool(wanted) and any(wanted in normalize(s) for s in sources)
