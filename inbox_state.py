"""Live Inbox: which messages are done.

Kept by Atlas (data/inbox-state.json, next to the database) rather than in the collectors' queue, which
Atlas only reads. Keys are the message's source and its Outlook or notification id, so a message stays
done when a queue is rebuilt and numbered again. The newest LIMIT entries are kept.
"""
import hashlib
import json
import os
import threading
import time

LIMIT = 5000
_lock = threading.Lock()


def key(source, entry_id):
    return hashlib.sha256(f'{source}\n{entry_id}'.encode('utf-8')).hexdigest()[:32]


class InboxState:
    def __init__(self, path):
        self._path = path

    @property
    def path(self):
        from pathlib import Path
        return Path(self._path() if callable(self._path) else self._path)

    def load(self):
        try:
            data = json.loads(self.path.read_text(encoding='utf-8'))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def get(self, source, entry_id):
        return self.load().get(key(source, entry_id))

    def done_keys(self):
        return {name for name, value in self.load().items() if value.get('done')}

    def set(self, source, entry_id, done, by=''):
        with _lock:
            data = self.load()
            name = key(source, entry_id)
            if done:
                data[name] = {'done': True, 'at': time.strftime('%Y-%m-%dT%H:%M:%S'), 'by': by}
            else:
                data.pop(name, None)
            if len(data) > LIMIT:
                data = dict(sorted(data.items(), key=lambda item: item[1].get('at', ''))[-LIMIT:])
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix('.tmp')
            temporary.write_text(json.dumps(data), encoding='utf-8')
            os.replace(temporary, self.path)
            return data.get(name)
