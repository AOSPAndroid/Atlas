import email.message
import tempfile
import unittest
import zipfile
from pathlib import Path

import assistant_files
from assistant_files import FileError
from assistant_grounding import check_item, command_found, command_in_notes, missing_specifics, normalize, quote_status, specifics, word_support

NOTES = ['Outlook freezing again on LT-PAR-0042 since 3 days. Error 0x80070005.\n'
         'Ran: Get-Process outlook | Stop-Process -Force\nEscalate to messaging team if mailbox > 50GB.']


class Grounding(unittest.TestCase):
    def test_normalize_ignores_case_accents_quotes_and_spacing(self):
        self.assertEqual(normalize('Réseau  “VPN”\u00a0—\nOK'), 'reseau "vpn" - ok')

    def test_quotes_must_be_in_the_source(self):
        self.assertEqual(quote_status('freezing again on LT-PAR-0042', NOTES), 'exact')
        self.assertEqual(quote_status('FREEZING   again on lt-par-0042', NOTES), 'exact')
        self.assertEqual(quote_status('Outlook freezng again on LT-PAR-0042', NOTES), 'close', 'Small typing or OCR differences')
        self.assertIsNone(quote_status('Outlook crashes when printing', NOTES))
        self.assertIsNone(quote_status('', NOTES))
        self.assertIsNone(quote_status('ok', NOTES), 'Two letters prove nothing')

    def test_specifics_are_found_once_and_whole(self):
        found = specifics('Reboot LT-PAR-0042, error 0x80070005, INC-12345, KB5034441, 10.1.2.3, bob@x.com, '
                          r'\\fs01\share\logs, C:\Temp\a.log, https://intranet/x, version 2.130.1, step 1.')
        self.assertEqual([v for _, v in found], ['bob@x.com', 'https://intranet/x', r'\\fs01\share\logs', r'C:\Temp\a.log', '10.1.2.3',
                                                  'LT-PAR-0042', 'INC-12345', '0x80070005', 'KB5034441', '2.130.1'])

    def test_invented_specifics_are_reported(self):
        self.assertEqual(missing_specifics('Reboot LT-PAR-0042 (error 0x80070005) after 3 days', NOTES), [])
        self.assertEqual(missing_specifics('Reboot LT-PAR-0043 and check KB5034441 within 50GB', NOTES), ['LT-PAR-0043', 'KB5034441'])
        self.assertEqual(missing_specifics('Wait 30 minutes', NOTES), ['30'], 'Numbers count: 3 is not 30')
        self.assertEqual(missing_specifics('Add the user to GRP-VPN-USERS or SG_APP_ADOBE, not Wi-Fi', NOTES), ['GRP-VPN-USERS', 'SG_APP_ADOBE'])

    def test_word_support(self):
        self.assertEqual(word_support('Outlook is freezing', NOTES), 1.0)
        self.assertLess(word_support('Reinstall Office from Software Center', NOTES), 0.3)
        self.assertEqual(word_support('', NOTES), 1.0)

    def test_check_item(self):
        self.assertEqual(check_item('Escalate to the messaging team for mailboxes over 50GB', 'Escalate to messaging team if mailbox > 50GB', NOTES)[:2], (True, []))
        ok, reasons, _ = check_item('Reinstall Office on PC9999', 'Outlook freezing', NOTES)
        self.assertFalse(ok)
        self.assertEqual(reasons, ['not in the source: PC9999', 'mostly words that are not in the source'])
        ok, reasons, _ = check_item('Outlook freezing since 3 days, escalate to the messaging team', 'since 3 days', NOTES, min_tie=0.5)
        self.assertEqual(reasons, ['it says more than the words it quotes'], 'A true quote cannot vouch for a different sentence')

    def test_commands_must_be_written_in_the_notes(self):
        self.assertTrue(command_found('get-process outlook |  Stop-Process -Force', NOTES))
        self.assertTrue(command_found('`Get-Process outlook`', NOTES))
        self.assertFalse(command_found('Remove-Item $env:LOCALAPPDATA\\Microsoft\\Outlook\\*.ost', NOTES))
        self.assertFalse(command_found('', NOTES))

    def test_garbled_commands_are_taken_from_the_notes(self):
        notes = ['fix:\n- del /Q C:\\Windows\\System32\\spool\\PRINTERS\\*\nRan: net stop spooler']
        self.assertEqual(command_in_notes('del /Q C:\\\\nWindows\\System32\\spool\\PRINTERS\\*', notes), 'del /Q C:\\Windows\\System32\\spool\\PRINTERS\\*')
        self.assertEqual(command_in_notes('net stop spoolr', notes), 'net stop spooler')
        self.assertEqual(command_in_notes('Remove-Item C:\\Windows\\System32\\spool\\PRINTERS\\*', notes), '', 'Never a different command')
        self.assertEqual(command_in_notes('net start spooler', notes), '', 'Too different from any line')


class Files(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.notes, self.other = base / 'notes', base / 'private'
        (self.notes / 'printers').mkdir(parents=True)
        self.other.mkdir()
        (self.notes / 'printers' / 'spooler.txt').write_bytes('Spooler – café\r\nnet stop spooler\r\n\r\n\r\n\r\nend'.encode('cp1252'))
        (self.notes / 'vpn.md').write_text('# VPN\nReinstall GlobalProtect', encoding='utf-8')
        (self.notes / 'image.png').write_bytes(b'\x89PNG')
        (self.notes / '~$lock.docx').write_bytes(b'x')
        (self.other / 'secret.txt').write_text('secret', encoding='utf-8')
        with zipfile.ZipFile(self.notes / 'runbook.docx', 'w') as z:
            z.writestr('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Step one</w:t></w:r></w:p><w:p><w:r><w:t>Step &amp; two</w:t></w:r></w:p></w:body></w:document>')
        with zipfile.ZipFile(self.notes / 'deck.pptx', 'w') as z:
            z.writestr('ppt/slides/slide2.xml', '<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>')
            z.writestr('ppt/slides/slide1.xml', '<p:sld><a:p><a:r><a:t>First</a:t></a:r></a:p></p:sld>')
        mail = email.message.EmailMessage()
        mail['From'], mail['Subject'] = 'Sam <sam@example.test>', 'Printer fixed'
        mail.set_content('The fix was to clear the queue.')
        (self.notes / 'fix.eml').write_bytes(bytes(mail))
        (self.notes / 'page.html').write_text('<p>Hello<br>there</p><script>bad()</script>', encoding='utf-8')
        self.config = {'assistant': {'folders': [str(self.notes), str(base / 'missing')]}}

    def tearDown(self):
        self.tmp.cleanup()

    def test_only_chosen_folders_can_be_read(self):
        self.assertEqual(assistant_files.folders(self.config), [self.notes.resolve()])
        for path in (self.other / 'secret.txt', self.notes / '..' / 'private' / 'secret.txt', '/etc/passwd', ''):
            with self.assertRaises(FileError):
                assistant_files.read(self.config, path)
        self.assertEqual(assistant_files.listing({}, '')['items'], [], 'No folders chosen: nothing to list')
        with self.assertRaises(FileError):
            assistant_files.listing(self.config, str(self.other))
        with self.assertRaisesRegex(FileError, 'Assistant settings'):
            assistant_files.read({}, self.notes / 'vpn.md')

    def test_listing(self):
        top = assistant_files.listing(self.config)
        self.assertEqual([i['path'] for i in top['items']], [str(self.notes.resolve())])
        inside = assistant_files.listing(self.config, str(self.notes))
        self.assertEqual([i['name'] for i in inside['items']], ['printers', 'deck.pptx', 'fix.eml', 'page.html', 'runbook.docx', 'vpn.md'],
                         'Folders first; images and Office lock files are left out')
        self.assertIsNone(inside['parent'], 'The chosen folder is the top')
        self.assertEqual(assistant_files.listing(self.config, str(self.notes / 'printers'))['parent'], str(self.notes.resolve()))

    def test_text_extraction(self):
        read = lambda name: assistant_files.read(self.config, self.notes / name)['text']
        self.assertEqual(assistant_files.read(self.config, self.notes / 'printers' / 'spooler.txt')['text'], 'Spooler – café\nnet stop spooler\n\nend')
        self.assertEqual(read('runbook.docx'), 'Step one\nStep & two')
        self.assertEqual(read('deck.pptx'), 'First\n\nSecond')
        self.assertIn('Subject: Printer fixed', read('fix.eml'))
        self.assertIn('The fix was to clear the queue.', read('fix.eml'))
        self.assertEqual(read('page.html'), 'Hello\nthere')
        with self.assertRaisesRegex(FileError, 'not supported'):
            read('image.png')

    def test_file_source_lists_signatures_and_skips_system_folders(self):
        for skipped in ('$RECYCLE.BIN', 'node_modules', 'AppData'):
            (self.notes / skipped).mkdir()
            (self.notes / skipped / 'x.txt').write_text('hidden', encoding='utf-8')
        source = assistant_files.FileSource(self.config)
        listing = source.listing()
        self.assertEqual(sorted(Path(p).name for p in listing), ['deck.pptx', 'fix.eml', 'page.html', 'runbook.docx', 'spooler.txt', 'vpn.md'])
        row = source.row(str(self.notes / 'vpn.md'))
        self.assertEqual((row['title'], row['body'], row['extra']['folder']), ('vpn.md', '# VPN\nReinstall GlobalProtect', str(self.notes.resolve())))
        path = str(self.notes / 'vpn.md')
        (self.notes / 'vpn.md').write_text('# VPN\nReinstall GlobalProtect, then reboot', encoding='utf-8')
        self.assertNotEqual(source.listing()[path], listing[path], 'A changed file gets a new signature')
        self.assertEqual(len(assistant_files.every_file(self.config, limit=2)), 2, 'Large drives stop at the limit')
        self.assertEqual(assistant_files.FileSource({}).listing(), {})

    def test_excel_cells(self):
        with zipfile.ZipFile(self.notes / 'contacts.xlsx', 'w') as z:
            z.writestr('xl/sharedStrings.xml', '<sst><si><t>Team</t></si><si><t>Phone</t></si><si><r><t>Print</t></r><r><t> &amp; scan</t></r></si></sst>')
            z.writestr('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
                       '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>4021</v></c></row><row r="3"><c t="inlineStr"><is><t>Note</t></is></c></row></sheetData></worksheet>')
        self.assertEqual(assistant_files.read(self.config, self.notes / 'contacts.xlsx')['text'], 'Team\tPhone\nPrint & scan\t4021\nNote')


if __name__ == '__main__':
    unittest.main()
