"""What the local Assistant does, and how each answer is checked before Atlas shows it.

1. draft_article: rough notes -> a Knowledge Base article draft. Every line carries a quote from
   the notes; lines whose quote or details are not in the notes are flagged for review, and
   commands that are not in the notes word for word are left out.
2. read_request: an email or screen text -> summary, what is asked, key facts, questions to ask
   and steps from your own articles and notes. Anything that fails the checks is hidden (and
   listed as hidden), so what is shown can be traced back to the message or to a cited source.
"""
import re

from assistant_grounding import check_item, command_found, command_in_notes, missing_specifics, normalize, quote_status, word_support

CHARS_PER_TOKEN = 3


def _item(max_items=None):
    item = {'type': 'object', 'properties': {'text': {'type': 'string'}, 'quote': {'type': 'string'}},
            'required': ['text', 'quote'], 'additionalProperties': False}
    return item if max_items is None else {'type': 'array', 'items': item, 'maxItems': max_items}


def _budget(runtime, output_tokens, prompt_tokens=700):
    context = int(runtime.settings().get('context') or 8192)
    return max(2000, (context - output_tokens - prompt_tokens) * CHARS_PER_TOKEN)


def _clip(sources, limit):
    """Share the character budget between sources; say when something was cut."""
    clipped, cut = [], False
    each = max(800, limit // max(1, len(sources)))
    for source in sources:
        text = source['text'].strip()
        if len(text) > each:
            text, cut = text[:each], True
        clipped.append({**source, 'text': text})
    return clipped, cut


# 1. Notes -> article --------------------------------------------------------------------------
DRAFT_SYSTEM = """You turn an IT support engineer's rough notes into a clear Knowledge Base article.
Rules:
- Use ONLY information written in the notes. Do not add steps, commands, product names, numbers, machine names or advice that are not in the notes.
- If the notes say nothing about a section, return an empty list for it.
- For every item, "quote" must be copied exactly, character for character, from the notes: the words that support the item. Never rephrase a quote.
- "text" is a short, clear sentence. Steps are written as instructions.
- Commands: copy them exactly as written in the notes.
- Write in the same language as the notes."""


def draft_schema(categories):
    return {'type': 'object', 'additionalProperties': False,
            'properties': {
                'title': {'type': 'string'},
                'summary': _item(),
                'symptoms': _item(8), 'causes': _item(5), 'steps': _item(15),
                'commands': {'type': 'array', 'maxItems': 8, 'items': {'type': 'object', 'additionalProperties': False,
                             'properties': {'command': {'type': 'string'}, 'purpose': {'type': 'string'}}, 'required': ['command', 'purpose']}},
                'escalate': _item(5),
                'tags': {'type': 'array', 'maxItems': 6, 'items': {'type': 'string'}},
                'categories': {'type': 'array', 'maxItems': 3, 'items': {'type': 'string', 'enum': categories}}},
            'required': ['title', 'summary', 'symptoms', 'causes', 'steps', 'commands', 'escalate', 'tags', 'categories']}


SECTIONS = [('symptoms', 'Symptoms', '-'), ('causes', 'Cause', '-'), ('steps', 'Steps', '1.'), ('escalate', 'Escalate when', '-')]


def _items(value):
    out, seen = [], set()
    for item in value if isinstance(value, list) else []:
        if not isinstance(item, dict):
            continue
        text = ' '.join(str(item.get('text') or '').split())
        if text and normalize(text) not in seen:
            seen.add(normalize(text))
            out.append({'text': text, 'quote': str(item.get('quote') or '')})
    return out


def draft_article(runtime, sources, title_hint=''):
    from inbox_analysis import CATEGORIES, contains, plain
    categories = [key for key, *_ in CATEGORIES]
    sources, cut = _clip(sources, _budget(runtime, 1800))
    notes = '\n\n'.join(f"### {s['name']}\n{s['text']}" for s in sources)
    hint = f'Suggested title: {title_hint}\n\n' if title_hint.strip() else ''
    answer, meta = runtime.chat(DRAFT_SYSTEM, f'{hint}NOTES:\n<<<\n{notes}\n>>>', draft_schema(categories), max_tokens=1800)
    texts = [s['text'] for s in sources] + ([title_hint] if title_hint else [])
    checks, dropped, lines = [], [], []

    def verify(section, item, min_support):
        ok, reasons, status = check_item(item['text'], item['quote'], texts, min_support=min_support, min_tie=0.25)
        if not ok:
            checks.append({'section': section, 'text': item['text'], 'reasons': reasons})
        elif status == 'close':
            checks.append({'section': section, 'text': item['text'], 'reasons': ['its quote only nearly matches the notes'], 'minor': True})
        return ok

    title = ' '.join(str(answer.get('title') or title_hint or 'New article').split())[:180]
    missing = missing_specifics(title, texts)
    if missing:
        checks.append({'section': 'Title', 'text': title, 'reasons': ['not in the notes: ' + ', '.join(missing)]})
    summary = _items([answer.get('summary')])
    if summary:
        verify('Summary', summary[0], 0.4)
        lines += ['## Summary', summary[0]['text'], '']
    for key, heading, bullet in SECTIONS:
        items = _items(answer.get(key))
        if not items:
            continue
        lines.append('## ' + heading)
        for number, item in enumerate(items, 1):
            verify(heading, item, 0.34)
            lines.append(f"{number}. {item['text']}" if bullet == '1.' else f"- {item['text']}")
        lines.append('')
    commands = []
    for item in answer.get('commands') if isinstance(answer.get('commands'), list) else []:
        command = str((item or {}).get('command') or '').strip().strip('`').strip()
        if not command:
            continue
        purpose = ' '.join(str(item.get('purpose') or '').split())
        recovered = '' if command_found(command, texts) else command_in_notes(command, texts)
        if command_found(command, texts):
            commands.append((command, purpose))
        elif recovered:
            commands.append((recovered, purpose))
            checks.append({'section': 'Commands', 'text': recovered, 'reasons': ['copied from your notes because the model changed it'], 'minor': True})
        else:
            dropped.append({'section': 'Commands', 'text': command, 'reasons': ['this command is not in the notes as written, so it was left out']})
    if commands:
        lines.append('## Commands')
        for command, purpose in commands:
            fence = '``' if '`' in command else '`'
            code = f'{fence} {command} {fence}' if fence == '``' else f'`{command}`'
            lines.append(f'- {purpose}: {code}' if purpose and not missing_specifics(purpose, texts) else f'- {code}')
        lines.append('')
    lines += ['## Sources'] + [f"- {s['name']}" for s in sources]
    known = {normalize(t) for t in texts}
    tags = []
    for tag in answer.get('tags') if isinstance(answer.get('tags'), list) else []:
        tag = ' '.join(str(tag).split())[:40]
        # Tags must be words from the notes; an invented tag would mislead search.
        if tag and any(normalize(tag) in t for t in known) and tag.casefold() not in {t.casefold() for t in tags}:
            tags.append(tag)
    # An issue type is kept only when one of its words is in the notes (the same words Live Inbox uses).
    words = plain('\n'.join(texts))
    chosen = [key for key, _, terms, *_ in CATEGORIES if key in (answer.get('categories') or []) and any(contains(words, t) for t in terms)][:3]
    return {'title': title, 'markdown': '\n'.join(lines).strip() + '\n', 'tags': tags, 'categories': list(dict.fromkeys(chosen)),
            'checks': checks, 'dropped': dropped, 'sources': [s['name'] for s in sources], 'cut': cut or meta['truncated'], **meta}


# 2. Read a request -----------------------------------------------------------------------------
READ_SYSTEM = """You help an IT support engineer read a request from a user (an email, chat or ticket).
Rules:
- Use ONLY the MESSAGE and the numbered SOURCES. Never use outside knowledge, never guess.
- Every "quote" must be copied exactly, character for character, from the MESSAGE (for summary, asks, facts) or from the cited SOURCE (for steps).
- summary: one sentence saying what the MESSAGE reports. Nothing from the sources.
- asks: what the user asks IT to do, in their words. Not your questions.
- facts: only details actually written in the message (machine name, application, error text, since when, location, urgency).
- questions: at most three short questions about things the message does NOT already say.
- steps: only steps written in a SOURCE that fit this request, each citing that source's id. If no source fits, return no steps.
- Write in the same language as the message."""
FACTS = ['machine', 'application', 'error', 'since', 'location', 'urgency', 'person', 'other']


def read_schema(source_ids):
    properties = {
        'summary': _item(), 'asks': _item(4),
        'facts': {'type': 'array', 'maxItems': 8, 'items': {'type': 'object', 'additionalProperties': False, 'required': ['label', 'value', 'quote'],
                  'properties': {'label': {'type': 'string', 'enum': FACTS}, 'value': {'type': 'string'}, 'quote': {'type': 'string'}}}},
        'questions': {'type': 'array', 'maxItems': 3, 'items': {'type': 'string'}}}
    if source_ids:
        properties['steps'] = {'type': 'array', 'maxItems': 8, 'items': {'type': 'object', 'additionalProperties': False, 'required': ['text', 'source', 'quote'],
                               'properties': {'text': {'type': 'string'}, 'source': {'type': 'string', 'enum': source_ids}, 'quote': {'type': 'string'}}}}
    return {'type': 'object', 'additionalProperties': False, 'properties': properties, 'required': list(properties)}


def references(wmi, subject, text, limit=3):
    """Your own articles and note files that share distinctive words with the request."""
    from search_index import fts_query, key_terms
    index = getattr(wmi, 'search_index', None)
    terms = key_terms(f'{subject} {subject} {text[:3000]}', limit=12)
    if index is None or not terms:
        return []
    try:
        common = index.common_terms(terms)
        terms = [t for t in terms if t not in common][:10] or terms
        found = index.search(fts_query(' '.join(terms), any_term=True), ('article', 'file'), limit,
                             require=(terms, 2 if len(terms) >= 3 else 1))
    except Exception:  # search problems never block reading the message itself
        return []
    result = []
    for hit in found:
        body = _reference_text(wmi, hit)
        if body:
            result.append({'id': f'S{len(result) + 1}', 'kind': hit['kind'], 'ref': hit['ref'],
                           'title': re.sub('[\x02\x03]', '', hit['title']), 'text': body})
    return result


def _reference_text(wmi, hit):
    try:
        if hit['kind'] == 'article':
            from knowledge_articles import all_articles
            from runtime_paths import knowledge_path
            article = next((a for a in all_articles(knowledge_path()) if a['id'] == hit['ref']), None)
            return article and f"{article['title']}\n{article['markdown']}"
        import assistant_files
        return assistant_files.read(wmi.CONFIG, hit['ref'])['text']
    except Exception:
        return ''


def read_request(runtime, subject, text, sources):
    message = f'{subject}\n{text}'.strip()
    budget = _budget(runtime, 1200)
    message = message[: max(3000, budget // 2)]
    sources, _ = _clip(sources, max(1500, budget - len(message)))
    blocks = ''.join(f"\n\nSOURCE {s['id']} ({'Knowledge Base article' if s['kind'] == 'article' else 'note file'}: {s['title']}):\n<<<\n{s['text']}\n>>>" for s in sources)
    answer, meta = runtime.chat(READ_SYSTEM, f'MESSAGE:\n<<<\n{message}\n>>>{blocks or chr(10) * 2 + "SOURCES: none"}',
                                read_schema([s['id'] for s in sources]), max_tokens=1200)
    hidden = []

    def keep(section, item, against, min_support=0.4, min_tie=0.0):
        ok, reasons, _ = check_item(item['text'], item['quote'], against, min_support=min_support, min_tie=min_tie)
        if not ok:
            hidden.append({'section': section, 'text': item['text'], 'reasons': reasons})
        return ok

    # A summary paraphrases the whole message, so it needs no exact quote, but it is checked against the
    # message alone: no new details, and mostly the user's own words (details pulled from a source are not).
    summary = []
    for item in _items([answer.get('summary')]):
        missing = missing_specifics(item['text'], [message])
        if missing or word_support(item['text'], [message]) < 0.6:
            hidden.append({'section': 'Summary', 'text': item['text'],
                           'reasons': ['not in the message: ' + ', '.join(missing)] if missing else ['mostly words that are not in the message']})
        else:
            summary.append(item)
    asked = {normalize(q) for q in answer.get('questions') or [] if isinstance(q, str)}
    asks = []
    for item in _items(answer.get('asks')):
        if normalize(item['text']) in asked:
            continue  # the same line given as a question to ask the user
        if keep('Asks', item, [message], min_tie=0.5):
            asks.append(item)
    facts = []
    for fact in answer.get('facts') if isinstance(answer.get('facts'), list) else []:
        if not isinstance(fact, dict):
            continue
        value, quote = ' '.join(str(fact.get('value') or '').split()), str(fact.get('quote') or '')
        if not value:
            continue
        reasons = []
        if not quote_status(quote, [message]):
            reasons.append('its quote is not in the message')
        if missing_specifics(value, [message]):
            reasons.append('not in the message: ' + ', '.join(missing_specifics(value, [message])))
        elif normalize(value) not in normalize(quote) and word_support(value, [message]) < 0.5:
            reasons.append('the value is not what the message says')
        label = fact.get('label') if fact.get('label') in FACTS else 'other'
        (hidden.append({'section': 'Facts', 'text': f'{label}: {value}', 'reasons': reasons}) if reasons
         else facts.append({'label': label, 'value': value, 'quote': quote}))
    questions = []
    for question in answer.get('questions') if isinstance(answer.get('questions'), list) else []:
        question = ' '.join(str(question).split())
        if not question:
            continue
        if missing_specifics(question, [message]):
            hidden.append({'section': 'Questions', 'text': question, 'reasons': ['mentions details that are not in the message']})
        elif word_support(question, [message]) >= 0.8:
            hidden.append({'section': 'Questions', 'text': question, 'reasons': ['the message probably answers it already']})
        else:
            questions.append(question)
    by_id = {s['id']: s for s in sources}
    steps = []
    for step in answer.get('steps') if isinstance(answer.get('steps'), list) else []:
        if not isinstance(step, dict) or not str(step.get('text') or '').strip():
            continue
        item = {'text': ' '.join(str(step['text']).split()), 'quote': str(step.get('quote') or '')}
        source = by_id.get(step.get('source'))
        if source is None:
            hidden.append({'section': 'Steps', 'text': item['text'], 'reasons': ['it cites no source']})
        elif keep('Steps', item, [source['text']], 0.34, min_tie=0.3):
            steps.append({**item, 'source': source['id']})
    return {'summary': summary[0]['text'] if summary else '',
            'asks': asks, 'facts': facts, 'questions': questions[:3], 'steps': steps, 'hidden': hidden,
            'sources': [{k: s[k] for k in ('id', 'kind', 'ref', 'title')} for s in sources], **meta}
