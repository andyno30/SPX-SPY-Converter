import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import local_fallback as fallback
import news_browser as browser
from test_local_fallback import FakeDB, article


class BrowserFetchTests(unittest.TestCase):
    def setup_browser(self, *, status=200, kind='application/json', challenge=None, payload=None):
        playwright = Mock()
        context = playwright.chromium.launch_persistent_context.return_value
        page = context.new_page.return_value
        response = page.goto.return_value
        response.status = status
        response.header_value.side_effect = lambda name: {'content-type': kind, 'cf-mitigated': challenge}.get(name)
        response.body.return_value = json.dumps(payload if payload is not None else {'news_list': [article()]}).encode()
        return playwright, context, page, response

    def test_both_feeds_preserve_existing_normalization_without_article_bodies(self):
        item = article()
        item.update(content='not forwarded', translations={'translated': {'en_US': {'title': 'Translated title', 'body': 'not forwarded'}}})
        pw, context, page, response = self.setup_browser(payload={'news_list': [item]})
        result = browser._fetch_with_browser(pw, 'temporary-profile')
        self.assertEqual(page.goto.call_count, 2)
        self.assertEqual([call.args[0] for call in page.goto.call_args_list], list(fallback.LIST_ENDPOINTS))
        trimmed = result['payloads'][0]['news_list'][0]
        self.assertEqual(fallback.normalize_news_row(trimmed), fallback.normalize_news_row(item))
        self.assertNotIn('not forwarded', json.dumps(result))
        context.close.assert_called_once()
        self.assertEqual(page.close.call_count, 2)
        pw.chromium.launch_persistent_context.assert_called_once_with('temporary-profile', headless=False, timeout=25000)

    def test_challenge_stops_before_body_second_request_or_interaction(self):
        pw, context, page, response = self.setup_browser(status=403, kind='text/html', challenge='challenge')
        result = browser._fetch_with_browser(pw, 'temporary-profile')
        self.assertEqual(result, {'error': 'challenge', 'group': 1, 'status': 403})
        page.goto.assert_called_once()
        response.body.assert_not_called()
        page.close.assert_called_once()
        context.close.assert_called_once()

    def test_http_html_malformed_and_oversized_responses_fail_closed(self):
        for mode, expected in (('403', 'http'), ('html', 'content'), ('malformed', 'schema'),
                               ('wrong_schema', 'schema'), ('oversized', 'size')):
            with self.subTest(mode=mode):
                pw, context, page, response = self.setup_browser()
                if mode == '403': response.status = 403
                if mode == 'html': response.header_value.side_effect = lambda name: 'text/html' if name == 'content-type' else None
                if mode == 'malformed': response.body.return_value = b'not json'
                if mode == 'wrong_schema': response.body.return_value = b'{}'
                if mode == 'oversized': response.body.return_value = b' ' * (browser.MAX_RESPONSE_BYTES + 1)
                self.assertEqual(browser._fetch_with_browser(pw, 'temporary-profile')['error'], expected)
                page.goto.assert_called_once()
                context.close.assert_called_once()

    def test_network_exception_closes_page_and_browser(self):
        pw, context, page, _ = self.setup_browser()
        page.goto.side_effect = RuntimeError('private diagnostic fixture')
        with self.assertRaises(RuntimeError): browser._fetch_with_browser(pw, 'temporary-profile')
        page.close.assert_called_once()
        context.close.assert_called_once()

    def test_browser_failure_preserves_database(self):
        db = FakeDB()
        with patch.object(fallback.sys, 'platform', 'darwin'), \
                patch.object(fallback, 'fetch_news_payloads', side_effect=browser.NewsBrowserError('News browser: failed')):
            with self.assertRaises(fallback.SafeError): fallback.run_news(db)
        self.assertEqual(db.writes, [])

    def test_non_mac_news_retrieval_is_unchanged(self):
        db = FakeDB()
        with patch.object(fallback.sys, 'platform', 'win32'), \
                patch.object(fallback, 'fetch_news_payloads') as fetch, \
                patch.object(fallback, 'request_json', return_value={'news_list': []}) as request:
            fallback.run_news(db)
        fetch.assert_not_called()
        self.assertEqual(request.call_count, 2)

    def test_failed_news_still_runs_options(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(fallback, 'ROOT', Path(directory)), \
                patch.object(fallback.sys, 'argv', ['updater']), \
                patch.object(fallback, 'load_credentials', return_value={}), \
                patch.object(fallback, 'Database'), \
                patch.object(fallback, 'run_news', side_effect=fallback.SafeError('News browser: failed')), \
                patch.object(fallback, 'run_options', return_value=0) as options:
            self.assertEqual(fallback.main(), 1)
        options.assert_called_once()


class WorkerIsolationTests(unittest.TestCase):
    def test_timeout_removes_profile_and_excludes_secrets_from_worker_environment(self):
        process = Mock()
        process.communicate.side_effect = subprocess.TimeoutExpired('worker', 90)
        with tempfile.TemporaryDirectory() as root:
            python = Path(root) / '.venv/bin/python'
            python.parent.mkdir(parents=True)
            python.touch()
            with patch.object(browser, 'ROOT', Path(root)), \
                    patch.dict(os.environ, {'UPSTREAM_ACCESS_TOKEN': 'private-fixture', 'SERVICE_ROLE_KEY': 'private-fixture'}), \
                    patch.object(browser.subprocess, 'Popen', return_value=process) as popen, \
                    patch.object(browser, '_stop_worker') as stop:
                with self.assertRaisesRegex(browser.NewsBrowserError, '90-second timeout'):
                    browser.fetch_news_payloads()
            command = popen.call_args.args[0]
            self.assertFalse(Path(command[-1]).exists())
            self.assertNotIn('UPSTREAM_ACCESS_TOKEN', popen.call_args.kwargs['env'])
            self.assertNotIn('SERVICE_ROLE_KEY', popen.call_args.kwargs['env'])
            self.assertTrue(popen.call_args.kwargs['start_new_session'])
            stop.assert_called_once_with(process)

    def test_worker_error_cannot_echo_untrusted_diagnostics(self):
        process = Mock(returncode=0)
        process.communicate.return_value = (b'{"error":"private-fixture","status":"private-fixture","group":"private-fixture"}', None)
        with patch.object(Path, 'is_file', return_value=True), \
                patch.object(browser.subprocess, 'Popen', return_value=process), \
                patch.object(browser, '_stop_worker'):
            with self.assertRaises(browser.NewsBrowserError) as caught: browser.fetch_news_payloads()
        self.assertNotIn('private-fixture', str(caught.exception))

    @unittest.skipUnless(sys.platform == 'darwin', 'Mac service shutdown')
    def test_service_stop_cleans_up_worker_and_profile(self):
        code = """
import json, subprocess, sys
from unittest.mock import patch
import news_browser as browser
real_popen = subprocess.Popen
def start_worker(args, **kwargs):
    worker = real_popen([sys.executable, '-c', 'import time; time.sleep(60)'], **kwargs)
    print(json.dumps({'pid': worker.pid, 'profile': args[-1]}), flush=True)
    return worker
with patch.object(browser.Path, 'is_file', return_value=True), patch.object(browser.subprocess, 'Popen', side_effect=start_worker):
    browser.fetch_news_payloads()
"""
        parent = subprocess.Popen([sys.executable, '-B', '-c', code], cwd=Path(browser.__file__).parent,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        worker = None
        try:
            worker = json.loads(parent.stdout.readline())
            parent.terminate()
            _, error = parent.communicate(timeout=10)
            self.assertEqual(parent.returncode, 128 + signal.SIGTERM, error)
            self.assertFalse(Path(worker['profile']).exists())
            with self.assertRaises(ProcessLookupError): os.kill(worker['pid'], 0)
        finally:
            parent.stdout.close()
            parent.stderr.close()
            if parent.poll() is None: parent.kill(); parent.wait()
            if worker:
                try: os.kill(worker['pid'], signal.SIGKILL)
                except ProcessLookupError: pass

    @unittest.skipUnless(sys.platform == 'darwin', 'Mac process group cleanup')
    def test_timeout_cleanup_stops_worker_and_child(self):
        code = 'import subprocess,sys,time; child=subprocess.Popen([sys.executable,"-c","import time;time.sleep(60)"]);print(child.pid,flush=True);time.sleep(60)'
        process = subprocess.Popen([sys.executable, '-B', '-c', code], stdout=subprocess.PIPE, start_new_session=True)
        child = int(process.stdout.readline())
        try:
            browser._stop_worker(process)
            self.assertIsNotNone(process.poll())
            state = subprocess.run(['ps', '-o', 'stat=', '-p', str(child)], capture_output=True, text=True).stdout.strip()
            self.assertTrue(not state or state.startswith('Z'), state)
        finally:
            process.stdout.close()
            for pid in (process.pid, child):
                try: os.kill(pid, signal.SIGKILL)
                except ProcessLookupError: pass


if __name__ == '__main__':
    unittest.main()
