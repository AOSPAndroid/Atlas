"""atlas_companion.py's Windows shell, driven through stand-in pywin32 modules (no Windows here):
clipboard reading order and privacy, the debounce timer, the tray menu and quitting."""
import struct
import sys
import types
import unittest
from unittest.mock import patch


class Fake(types.ModuleType):
    def __getattr__(self, name):
        if name.isupper():
            return hash(name) & 0xFFFF  # Any constant: unique per name.
        raise AttributeError(name)


def modules(clipboard):
    calls = []
    clip = Fake('win32clipboard')
    clip.CF_UNICODETEXT, clip.CF_DIB = 13, 8
    registered = {'CanIncludeInClipboardHistory': 0xC101, 'ExcludeClipboardContentFromMonitorProcessing': 0xC102, 'HTML Format': 0xC103}
    names = {v: k for k, v in registered.items()}
    clip.OpenClipboard = lambda hwnd: calls.append('open')
    clip.CloseClipboard = lambda: calls.append('close')
    order = list(clipboard)
    clip.EnumClipboardFormats = lambda previous: (order[order.index(previous) + 1] if previous in order and order.index(previous) + 1 < len(order) else 0) if previous else (order[0] if order else 0)
    clip.GetClipboardFormatName = lambda value: names[value]
    clip.RegisterClipboardFormat = lambda name: registered[name]
    clip.GetClipboardData = lambda value: clipboard[value]
    con = Fake('win32con'); con.CF_HDROP = 15
    gui = Fake('win32gui')
    for name in ('PostMessage', 'Shell_NotifyIcon', 'AppendMenu', 'SetForegroundWindow', 'TrackPopupMenu', 'DestroyWindow', 'PostQuitMessage'):
        setattr(gui, name, lambda *args, n=name: calls.append(n))
    gui.CreatePopupMenu = lambda: 'menu'
    gui.GetCursorPos = lambda: (10, 10)
    gui.LoadImage = lambda *args: 'icon'
    gui.DefWindowProc = lambda *args: 'default'
    pywintypes = Fake('pywintypes'); pywintypes.error = type('error', (Exception,), {})
    return {'win32api': Fake('win32api'), 'win32clipboard': clip, 'win32con': con, 'win32gui': gui, 'pywintypes': pywintypes}, calls


class WindowsShell(unittest.TestCase):
    def companion(self, clipboard):
        fakes, calls = modules(clipboard)
        patcher = patch.dict(sys.modules, fakes); patcher.start(); self.addCleanup(patcher.stop)
        import atlas_companion
        user32 = types.SimpleNamespace(SetTimer=lambda *a: calls.append('SetTimer'), KillTimer=lambda *a: calls.append('KillTimer'),
                                       RemoveClipboardFormatListener=lambda *a: calls.append('RemoveListener'))
        ctypes = patch.object(atlas_companion.ctypes, 'windll', types.SimpleNamespace(user32=user32), create=True)
        ctypes.start(); self.addCleanup(ctypes.stop)
        companion = atlas_companion.Companion()
        companion.hwnd, companion.taskbar_created = 1, 0xC200
        return atlas_companion, companion, calls

    def test_clipboard_content_in_priority_order(self):
        dib = struct.pack('<IiiHHIIiiII', 40, 1, 1, 1, 24, 0, 4, 0, 0, 0, 0) + b'\0' * 4
        _, companion, calls = self.companion({0xC103: b'<b>html</b>', 13: 'GBRPWMF20847950', 8: dib})
        self.assertEqual(companion.read_clipboard(), {'text': 'GBRPWMF20847950'}, 'Excel puts text and a picture: text wins')
        self.assertEqual(calls[-1], 'close', 'The clipboard is always closed again')
        _, companion, _ = self.companion({8: dib})
        self.assertEqual(companion.read_clipboard()['image'][:2], b'BM')
        _, companion, _ = self.companion({15: (r'C:\a.txt', r'C:\b.txt')})
        self.assertEqual(companion.read_clipboard(), {'files': [r'C:\a.txt', r'C:\b.txt']})

    def test_password_manager_copies_are_private(self):
        _, companion, _ = self.companion({0xC102: b'', 13: 'hunter2'})
        self.assertEqual(companion.read_clipboard(), {'private': True})
        _, companion, _ = self.companion({0xC101: struct.pack('<I', 0), 13: 'hunter2'})
        self.assertEqual(companion.read_clipboard(), {'private': True})
        _, companion, _ = self.companion({0xC101: struct.pack('<I', 1), 13: 'fine to keep'})
        self.assertEqual(companion.read_clipboard(), {'text': 'fine to keep'})

    def test_window_messages(self):
        module, companion, calls = self.companion({13: 'LAPTOP-0001'})
        self.assertEqual(companion.wndproc(1, module.WM_CLIPBOARDUPDATE, 0, 0), 0)
        self.assertEqual(calls[-1], 'SetTimer', 'Copies are read once the clipboard settles')
        companion.wndproc(1, module.WM_TIMER, module.CLIP_TIMER, 0)
        self.assertEqual(companion.outbox.get_nowait(), {'text': 'LAPTOP-0001'})
        companion.forwarder.paused = True
        companion.wndproc(1, module.WM_TIMER, module.CLIP_TIMER, 0)
        self.assertTrue(companion.outbox.empty(), 'Paused: nothing is read')
        companion.wndproc(1, module.WM_COMMAND, module.MENU_PAUSE, 0)
        self.assertFalse(companion.forwarder.paused)
        con = sys.modules['win32con']
        companion.wndproc(1, module.TRAY, 0, con.WM_RBUTTONUP)
        self.assertIn('TrackPopupMenu', calls)
        self.assertIn('Atlas Companion · waiting for Atlas · clipboard 0 copies sent', companion.tooltip())
        self.assertEqual(companion.wndproc(1, 0x1234, 0, 0), 'default')
        companion.icon_added = True
        companion.wndproc(1, con.WM_DESTROY, 0, 0)
        self.assertTrue(companion.stop.is_set())
        self.assertIn('RemoveListener', calls)
        self.assertIn('PostQuitMessage', calls)


    def test_outlook_reply_open_and_done(self):
        module, companion, calls = self.companion({})
        class Item:
            Categories, UnRead, saved = 'Rouge', True, 0
            def __init__(self): self.replies = []
            def Reply(self): return self.reply('reply')
            def ReplyAll(self): return self.reply('all')
            def reply(self, kind):
                reply = types.SimpleNamespace(kind=kind, BodyFormat=2, HTMLBody='<html><body><p>quoted</p></body></html>', shown=None)
                reply.Display = lambda modal: setattr(reply, 'shown', modal)
                self.replies.append(reply); return reply
            def Display(self, modal): calls.append(('display', modal))
            def Save(self): self.saved += 1
        item, asked = Item(), []
        namespace = types.SimpleNamespace(GetItemFromID=lambda entry, *store: asked.append((entry, *store)) or item)
        client = types.ModuleType('win32com.client'); client.Dispatch = lambda name: types.SimpleNamespace(GetNamespace=lambda kind: namespace)
        package = types.ModuleType('win32com'); package.client = client
        with patch.dict(sys.modules, {'win32com': package, 'win32com.client': client}), patch.object(module.core, 'store_for', return_value='STORE-1'):
            self.assertEqual(companion.outlook_reply({'entry_id': 'E1', 'source': 's', 'text': 'Bonjour,\nC\'est fait.', 'reply_all': True}), {'opened': 'reply_all'})
            reply = item.replies[0]
            self.assertEqual((reply.kind, reply.shown), ('all', False), 'Opened for the operator to send, never sent')
            self.assertIn('<p>Bonjour,</p><p>C&#x27;est fait.</p>', reply.HTMLBody)
            self.assertTrue(reply.HTMLBody.endswith('<p>quoted</p></body></html>'))
            self.assertEqual(asked[0], ('E1', 'STORE-1'))
            companion.outlook_open({'entry_id': 'E1', 'source': 's'})
            self.assertIn(('display', False), calls)
            with patch.object(module, 'list_separator', return_value=';'):
                companion.outlook_done({'entry_id': 'E1', 'source': 's', 'done': True})
            self.assertEqual((item.Categories, item.UnRead, item.saved), ('Rouge; Atlas: done', False, 1))

    def test_links_alerts_and_the_listener_window(self):
        module, companion, calls = self.companion({})
        opened = []
        with patch.object(module.os, 'startfile', create=True, new=lambda url: opened.append(url)):
            companion.open_url({'url': 'msteams:/l/chat/0/0?users=alex@example.test'})
            with self.assertRaises(ValueError):
                companion.open_url({'url': 'file:///C:/Windows/System32/cmd.exe'})
        self.assertEqual(opened, ['msteams:/l/chat/0/0?users=alex@example.test'])
        companion.notify({'title': 'Queue finished', 'text': '3 of 3 done', 'path': '/installer#history'})
        self.assertEqual(calls[-1], 'PostMessage', 'Shown on the window thread')
        shown = []
        module.win32gui = sys.modules['win32gui']
        sys.modules['win32gui'].Shell_NotifyIcon = lambda message, data: shown.append(data)
        companion.wndproc(1, module.ALERT, 0, 0)
        self.assertEqual((shown[0][6], shown[0][8]), ('3 of 3 done', 'Queue finished'))
        self.assertTrue(shown[0][2] & module.NIF_INFO)
        with patch.object(module.webbrowser, 'open', new=lambda url: opened.append(url)):
            companion.wndproc(1, module.TRAY, 0, module.NIN_BALLOONUSERCLICK)
        self.assertEqual(opened[-1], 'http://127.0.0.1:8770/installer#history', 'Clicking the alert opens Atlas there')
        self.assertEqual(companion.show_notifications({}), {'requested': True})
        self.assertTrue(companion.show_listener.is_set())

if __name__ == '__main__':
    unittest.main()
