import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import background_browser as bg
import news_browser
import options_browser
import test_news_browser as news_fixtures
import test_options_browser as options_fixtures


class ConfigurationTests(unittest.TestCase):
    def test_default_off_and_independent_atomic_rollback(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(bg, 'STATE', Path(directory)), \
                patch.object(bg, 'CONFIG', Path(directory) / 'config.json'), \
                patch.object(bg, 'helper_path', return_value=Path(__file__)):
            self.assertEqual(bg.settings(), {'news': False, 'options': False})
            bg.configure('news', True)
            self.assertTrue(bg.enabled('news'))
            self.assertFalse(bg.enabled('options'))
            bg.configure('news', False)
            self.assertFalse(bg.enabled('news'))
            self.assertEqual(bg.CONFIG.stat().st_mode & 0o777, 0o600)

    def test_invalid_settings_never_select_visible_fallback(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(bg, 'CONFIG', Path(directory) / 'config.json'):
            for value in ('{}', 'invalid json', '{"news":"false","options":false}', '{"news":true}'):
                bg.CONFIG.write_text(value)
                with self.assertRaises((ValueError, bg.BackgroundBrowserError)):
                    bg.enabled('news')

    def test_upgraded_playwright_fails_before_launch(self):
        with patch.object(bg, 'version', return_value='future'):
            with self.assertRaises(bg.BackgroundBrowserError):
                bg.default_arguments('/temporary-profile')

    def test_missing_native_helper_cleans_temp_directory_without_browser(self):
        with patch.object(bg, 'helper_path', return_value=Path('/missing-background-helper')), \
                patch.object(bg.subprocess, 'Popen') as popen:
            before = set(Path('/private/tmp').glob('spy-bg-*'))
            with self.assertRaises(bg.BackgroundBrowserError):
                bg.BackgroundBrowser(Mock(), 'news')
            self.assertEqual(set(Path('/private/tmp').glob('spy-bg-*')), before)
            popen.assert_not_called()


class WorkerIntegrationTests(unittest.TestCase):
    def test_news_uses_identical_validation_and_background_pages(self):
        pw, context, page, _ = news_fixtures.BrowserFetchTests().setup_browser()
        launcher = Mock(context=context)
        launcher.new_page.return_value = page
        with patch.object(bg, 'BackgroundBrowser', return_value=launcher):
            result = news_browser._fetch_with_browser(pw, 'unused', background=True)
        self.assertEqual(len(result['payloads']), 2)
        self.assertEqual(launcher.new_page.call_count, 2)
        launcher.close.assert_called_once()
        context.close.assert_not_called()  # retained blank lives until Browser.close
        pw.chromium.launch_persistent_context.assert_not_called()

    def test_options_preserves_context_cookie_schema_and_cleanup(self):
        pw, engine, context, page, _ = options_fixtures.BrowserFetchTests().setup_browser()
        engine.new_page.return_value = page
        with patch.object(bg, 'BackgroundBrowser', return_value=engine):
            result = options_browser._fetch_with_browser(pw, 'SPY', 'fixture', background=True)
        self.assertEqual(result['payload']['symbol'], 'SPY')
        self.assertIn('gammaUpdatedAt', result['payload'])
        engine.new_context.assert_called_once_with(accept_downloads=False, service_workers='block')
        self.assertEqual([c['name'] for c in context.add_cookies.call_args.args[0]], ['access_token'])
        context.close.assert_called_once()
        engine.close.assert_called_once()
        pw.chromium.launch.assert_not_called()

    def test_startup_failure_never_falls_back_to_visible_browser(self):
        for kind in ('news', 'options'):
            pw = Mock()
            with self.subTest(kind=kind), patch.object(bg, 'BackgroundBrowser', side_effect=bg.BackgroundBrowserError()):
                with self.assertRaises(bg.BackgroundBrowserError):
                    if kind == 'news':
                        news_browser._fetch_with_browser(pw, 'unused', background=True)
                    else:
                        options_browser._fetch_with_browser(pw, 'SPY', 'fixture', background=True)
            pw.chromium.launch.assert_not_called()
            pw.chromium.launch_persistent_context.assert_not_called()

    def test_news_second_feed_failure_discards_first_and_cleans_worker(self):
        pw, context, page, response = news_fixtures.BrowserFetchTests().setup_browser()
        launcher = Mock(context=context)
        launcher.new_page.return_value = page
        page.goto.side_effect = [response, RuntimeError('local timeout fixture')]
        with patch.object(bg, 'BackgroundBrowser', return_value=launcher):
            with self.assertRaises(RuntimeError):
                news_browser._fetch_with_browser(pw, 'unused', background=True)
        launcher.close.assert_called_once()
        self.assertEqual(page.close.call_count, 2)

    def test_cleanup_failure_discards_valid_payload(self):
        pw, engine, context, page, _ = options_fixtures.BrowserFetchTests().setup_browser()
        engine.new_page.return_value = page
        engine.close.side_effect = bg.BackgroundBrowserError('cleanup fixture')
        with patch.object(bg, 'BackgroundBrowser', return_value=engine):
            with self.assertRaises(bg.BackgroundBrowserError):
                options_browser._fetch_with_browser(pw, 'SPY', 'fixture', background=True)


class PageTests(unittest.TestCase):
    def test_target_is_unfocused_and_matches_exact_page(self):
        engine = bg.BackgroundBrowser.__new__(bg.BackgroundBrowser)
        engine.check = Mock()
        context = Mock()
        wrong, correct = Mock(), Mock()
        context.pages = [wrong, correct]
        sessions = [Mock(), Mock()]
        for session, target in zip(sessions, ['unrelated', 'wanted']):
            session.send.return_value = {'targetInfo': {'targetId': target}}
        context.new_cdp_session.side_effect = sessions
        engine.context_ids = {id(context): 'private-context'}
        engine.session = Mock()
        engine.session.send.return_value = {'targetId': 'wanted'}
        self.assertIs(engine.new_page(context), correct)
        engine.session.send.assert_called_once_with('Target.createTarget', {
            'url': 'about:blank', 'background': True, 'focus': False,
            'browserContextId': 'private-context'})
        for session in sessions:
            session.detach.assert_called_once()


if __name__ == '__main__':
    unittest.main()
