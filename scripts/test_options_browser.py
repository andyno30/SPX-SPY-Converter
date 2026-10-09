import contextlib
import io
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
import options_browser as browser
from test_local_options import row


def source():
    return {'symbol': 'SPY', 'referencePrice': 100, 'nearestExpiry': '2026-10-09',
            'maxPain': 101, 'putCallRatioVolume': 1.2, 'putCallRatioOpenInterest': 1.3,
            'volume': 1200, 'callWall': 110, 'putWall': 90, 'gammaFlip': 102,
            'gammaPer1Pct': 123456, 'volumeShare': {}, 'openInterestShare': {},
            'premiumShare': {}, 'snapshotUpdatedAt': '2026-10-09T13:00:00Z',
            'asOf': '2026-10-09T12:59:00Z', 'gammaUpdatedAt': '2026-10-09T13:01:00Z'}


class BrowserFetchTests(unittest.TestCase):
    def setup_browser(self):
        playwright = Mock()
        engine = playwright.chromium.launch.return_value
        context = engine.new_context.return_value
        page = context.new_page.return_value
        response = page.goto.return_value
        response.status = 200
        response.header_value.side_effect = lambda name: 'application/json' if name == 'content-type' else None
        response.body.return_value = json.dumps(source()).encode()
        return playwright, engine, context, page, response

    def test_only_application_cookie_in_fresh_nonpersistent_context(self):
        pw, engine, context, page, response = self.setup_browser()
        self.assertEqual(browser._fetch_with_browser(pw, 'SPY', 'private-fixture')['payload'], source())
        pw.chromium.launch.assert_called_once_with(headless=False, timeout=25000)
        engine.new_context.assert_called_once_with(accept_downloads=False, service_workers='block')
        context.add_cookies.assert_called_once_with([{'name': 'access_token', 'value': 'private-fixture',
            'url': 'https://saveticker.com', 'httpOnly': True, 'secure': True, 'sameSite': 'Lax'}])
        page.goto.assert_called_once_with('https://saveticker.com/api/stocks/api/v1/tickers/SPY/options',
                                          wait_until='commit', timeout=25000)
        context.close.assert_called_once()
        engine.close.assert_called_once()

    def test_redirects_other_origins_and_subresources_are_blocked(self):
        pw, _, context, _, _ = self.setup_browser()
        browser._fetch_with_browser(pw, 'SPY', 'private-fixture')
        handler = context.route.call_args.args[1]
        endpoint = 'https://saveticker.com/api/stocks/api/v1/tickers/SPY/options'
        for url, kind, redirected, allowed in ((endpoint, 'document', None, True),
                (endpoint, 'document', Mock(), False), (endpoint, 'image', None, False),
                ('https://example.test/', 'document', None, False),
                (endpoint.replace('SPY', 'QQQ'), 'document', None, False)):
            route = Mock()
            route.request.url = url; route.request.resource_type = kind; route.request.redirected_from = redirected
            handler(route)
            self.assertEqual(route.continue_.called, allowed)
            self.assertEqual(route.abort.called, not allowed)

    def test_challenge_stops_without_reading_body_or_retrying(self):
        pw, engine, context, page, response = self.setup_browser()
        response.status = 403
        response.header_value.side_effect = lambda name: 'challenge' if name == 'cf-mitigated' else 'text/html'
        self.assertEqual(browser._fetch_with_browser(pw, 'SPY', 'private-fixture'), {'error':'challenge','status':403})
        response.body.assert_not_called(); page.goto.assert_called_once()
        context.close.assert_called_once(); engine.close.assert_called_once()

    def test_http_html_invalid_json_wrong_ticker_and_oversize_fail_closed(self):
        for mode, code in (('401','http'), ('html','content'), ('invalid','schema'),
                           ('wrong_ticker','schema'), ('missing_fields','schema'), ('oversize','size')):
            with self.subTest(mode=mode):
                pw, engine, context, page, response = self.setup_browser()
                if mode == '401': response.status = 401
                if mode == 'html': response.header_value.side_effect = lambda name: 'text/html' if name == 'content-type' else None
                if mode == 'invalid': response.body.return_value = b'not json'
                if mode == 'wrong_ticker': response.body.return_value = json.dumps(dict(source(), symbol='QQQ')).encode()
                if mode == 'missing_fields': response.body.return_value = b'{}'
                if mode == 'oversize': response.body.return_value = b' ' * (browser.MAX_RESPONSE_BYTES + 1)
                self.assertEqual(browser._fetch_with_browser(pw, 'SPY', 'private-fixture')['error'], code)
                page.goto.assert_called_once(); context.close.assert_called_once(); engine.close.assert_called_once()

    def test_network_error_still_closes_context_and_browser(self):
        pw, engine, context, page, _ = self.setup_browser()
        page.goto.side_effect = RuntimeError('private fixture')
        with self.assertRaises(RuntimeError): browser._fetch_with_browser(pw, 'SPY', 'private-fixture')
        context.close.assert_called_once(); engine.close.assert_called_once()

    def test_mac_integration_preserves_normalization_and_gamma_revision(self):
        with patch.object(fallback.sys, 'platform', 'darwin'), \
                patch.object(fallback, 'fetch_options_payload', return_value=source()) as fetch, \
                patch.object(fallback, 'request_json') as http, contextlib.redirect_stdout(io.StringIO()):
            result = fallback.fetch_options('SPY', 'private-fixture')
        fetch.assert_called_once_with('SPY','private-fixture'); http.assert_not_called()
        self.assertEqual(result.gamma_updated_at, source()['gammaUpdatedAt'])
        result.pop('fetchedAt')
        self.assertEqual(result, fallback.normalize_options(source(),'SPY'))

    def test_spy_browser_failure_leaves_all_cache_rows_untouched(self):
        db = Mock(); db.options_row.return_value = row()
        with patch.object(fallback.sys,'platform','darwin'), \
                patch.object(fallback,'within_options_refresh_window',return_value=True), \
                patch.object(fallback,'allowed_tickers',return_value=['SPY','QQQ']), \
                patch.object(fallback,'fetch_options_payload',side_effect=browser.OptionsBrowserError('Options SPY: blocked')) as fetch, \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(fallback.run_options(db,'private-fixture'),1)
        fetch.assert_called_once(); db.save_options.assert_not_called()


class WorkerIsolationTests(unittest.TestCase):
    def test_token_uses_pipe_only_and_timeout_cleans_up(self):
        process = Mock()
        process.communicate.side_effect = subprocess.TimeoutExpired('worker',60)
        previous = signal.getsignal(signal.SIGTERM)
        with patch.object(Path,'is_file',return_value=True), \
                patch.dict(os.environ,{'SERVICE_ROLE_KEY':'backend-fixture','UPSTREAM_ACCESS_TOKEN':'private-fixture'}), \
                patch.object(browser.subprocess,'Popen',return_value=process) as popen, \
                patch.object(browser,'_stop_worker') as stop:
            with self.assertRaisesRegex(browser.OptionsBrowserError,'60-second'):
                browser.fetch_options_payload('SPY','private-fixture')
        command=popen.call_args.args[0]; settings=popen.call_args.kwargs
        self.assertNotIn('private-fixture',json.dumps(command))
        self.assertNotIn('private-fixture',json.dumps(settings['env']))
        self.assertNotIn('backend-fixture',json.dumps(settings['env']))
        self.assertEqual(settings['stdin'],subprocess.PIPE)
        self.assertTrue(settings['start_new_session'])
        self.assertFalse(Path(settings['cwd']).exists())
        self.assertEqual(json.loads(process.communicate.call_args.args[0]),{'ticker':'SPY','token':'private-fixture'})
        self.assertEqual(signal.getsignal(signal.SIGTERM),previous); stop.assert_called_once_with(process)

    def test_untrusted_worker_errors_cannot_expose_token(self):
        process=Mock(returncode=0)
        process.communicate.return_value=(b'{"error":"private-fixture","status":"private-fixture"}',None)
        with patch.object(Path,'is_file',return_value=True), \
                patch.object(browser.subprocess,'Popen',return_value=process), patch.object(browser,'_stop_worker'):
            with self.assertRaises(browser.OptionsBrowserError) as caught:browser.fetch_options_payload('SPY','private-fixture')
        self.assertNotIn('private-fixture',str(caught.exception))

    def test_bad_configuration_never_starts_worker(self):
        for ticker,token in [('SPY',''),('SPY','access_token=fixture'),('SPY','cf_clearance=fixture'),
                             ('SPY','fixture; extra=value'),('../SPY','fixture')]:
            with patch.object(browser.subprocess,'Popen') as popen:
                with self.assertRaises(browser.OptionsBrowserError):browser.fetch_options_payload(ticker,token)
            popen.assert_not_called()

    @unittest.skipUnless(sys.platform=='darwin','Mac service shutdown')
    def test_service_stop_removes_worker_and_temporary_files(self):
        code="""
import json,subprocess,sys
from unittest.mock import patch
import options_browser as browser
real_popen=subprocess.Popen
def start(args,**kwargs):
    worker=real_popen([sys.executable,'-c','import time;time.sleep(60)'],**kwargs)
    print(json.dumps({'pid':worker.pid,'directory':kwargs['cwd']}),flush=True)
    return worker
with patch.object(browser.Path,'is_file',return_value=True),patch.object(browser.subprocess,'Popen',side_effect=start):
    browser.fetch_options_payload('SPY','private-fixture')
"""
        parent=subprocess.Popen([sys.executable,'-B','-c',code],cwd=Path(browser.__file__).parent,
                                stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        worker=None
        try:
            worker=json.loads(parent.stdout.readline());parent.terminate()
            _,error=parent.communicate(timeout=10)
            self.assertEqual(parent.returncode,128+signal.SIGTERM,error)
            self.assertFalse(Path(worker['directory']).exists())
            with self.assertRaises(ProcessLookupError):os.kill(worker['pid'],0)
        finally:
            parent.stdout.close();parent.stderr.close()
            if parent.poll() is None:parent.kill();parent.wait()
            if worker:
                try:os.kill(worker['pid'],signal.SIGKILL)
                except ProcessLookupError:pass


if __name__=='__main__':unittest.main()
