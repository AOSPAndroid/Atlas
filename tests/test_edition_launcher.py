import unittest
from unittest.mock import patch
import edition_launcher as e

class EditionLauncherTests(unittest.TestCase):
    def test_all_six_share_one_start(self):
        with patch.object(e.launcher, "run", return_value=0) as start, patch.object(e.webbrowser, "open_new_tab") as browser:
            self.assertEqual(e.launch("both", "all"), 0)
            start.assert_called_once_with(open_browser=False)
            self.assertEqual([c.args[0] for c in browser.call_args_list], [e.edition_url(layout, mode) for layout in ("classic", "desktop") for mode in ("admin", "demo", "preview")])

    def test_failure_does_not_open_tabs(self):
        with patch.object(e.launcher, "run", return_value=1), patch.object(e.webbrowser, "open_new_tab") as browser:
            self.assertEqual(e.launch("both", "all"), 1)
            browser.assert_not_called()

    def test_existing_edition_and_no_browser(self):
        with patch.object(e.launcher, "run", return_value=0), patch.object(e.webbrowser, "open_new_tab") as browser:
            self.assertEqual(e.launch("classic", "all"), 0)
            self.assertEqual(browser.call_count, 2)
            browser.reset_mock()
            self.assertEqual(e.launch("both", "all", False), 0)
            browser.assert_not_called()

    def test_preview_only_does_not_start_servers(self):
        with patch.object(e.launcher, "run") as start, patch.object(e.webbrowser, "open_new_tab") as browser:
            self.assertEqual(e.launch("both", "preview"), 0)
            start.assert_not_called()
            self.assertEqual(browser.call_count, 2)

if __name__ == "__main__":
    unittest.main()
