"""Real localhost fixtures opt in with SPY_LOCAL_BROWSER_TESTS=1. No live APIs."""

import contextlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
import threading
import time
import unittest
from unittest.mock import Mock, patch

import browser_navigation as navigation
import news_browser
import options_browser
import local_fallback
import sync_news
from test_local_fallback import article
from test_options_browser import source


class AccountingTests(unittest.TestCase):
    def test_only_bounded_metadata_is_logged(self):
        report = {'label': 'options_SPY', 'attempts': 2, 'statuses': [307, 200],
                  'redirects': 1, 'blocked_redirects': 0, 'blocked_requests': 3,
                  'complete': True, 'url': 'private-fixture', 'cookies': 'private-fixture'}
        output = io.StringIO()
        with patch.object(navigation.logging, 'getLogger', return_value=Mock(handlers=[])), \
                contextlib.redirect_stdout(output):
            navigation.emit_accounting([report])
            navigation.emit_accounting([dict(report, label='private-fixture')])
            navigation.emit_accounting([dict(report, statuses=['private-fixture'])])
            navigation.emit_accounting([dict(report, attempts='private-fixture')])
            navigation.emit_accounting(None)
        self.assertNotIn('private-fixture', output.getvalue())
        self.assertIn('attempts=2, responses=[307, 200], redirects=1', output.getvalue())
        self.assertEqual(output.getvalue().count('unavailable'), 4)

    def test_scheduled_accounting_uses_existing_rotating_logger(self):
        logger = Mock(handlers=[object()])
        with patch.object(navigation.logging, 'getLogger', return_value=logger), \
                patch('builtins.print') as output:
            navigation.emit_accounting([])
        logger.info.assert_called_once()
        output.assert_not_called()

    def test_invalid_limits_and_foreign_destinations_fail_before_cdp(self):
        context = Mock()
        for limit in (-1, 6, True, '1'):
            with self.assertRaises(ValueError):
                navigation.NavigationGuard(context, Mock(), 'https://fixture.test/api', 'options_SPY',
                                           redirect_limit=limit)
        for destination in ('http://fixture.test/api', 'https://other.test/api',
                            'https://user:private-fixture@fixture.test/api', 'https://fixture.test/api#fragment'):
            with self.assertRaises(ValueError):
                navigation.NavigationGuard(context, Mock(), 'https://fixture.test/api', 'options_SPY',
                                           allowed_redirects=[destination])
        context.new_cdp_session.assert_not_called()

    def test_cdp_startup_exception_detaches_session(self):
        context = Mock()
        session = context.new_cdp_session.return_value
        session.send.side_effect = RuntimeError('local fixture')
        with self.assertRaises(RuntimeError):
            navigation.NavigationGuard(context, Mock(), 'https://fixture.test/api', 'options_SPY')
        session.detach.assert_called_once()


@unittest.skipUnless(os.environ.get('SPY_LOCAL_BROWSER_TESTS') == '1', 'explicit localhost browser fixtures')
class LocalNavigationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright
        cls.requests = []
        cls.routes = {}
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                cls.requests.append((self.server.server_port, self.path))
                status, headers, body, delay = cls.routes.get(self.path, (404, {}, b'', 0))
                if delay: time.sleep(delay)
                try:
                    self.send_response(status)
                    for key, value in headers.items(): self.send_header(key, value)
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError): pass
        cls.servers = [ThreadingHTTPServer(('127.0.0.1', 0), Handler) for _ in range(2)]
        cls.threads = [threading.Thread(target=s.serve_forever, daemon=True) for s in cls.servers]
        for thread in cls.threads: thread.start()
        cls.base = f'http://127.0.0.1:{cls.servers[0].server_port}'
        cls.other = f'http://127.0.0.1:{cls.servers[1].server_port}'
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(headless=True, args=[
            '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
            '--proxy-server=http://127.0.0.1:9'], env={k:v for k,v in os.environ.items()
                if k in ('HOME', 'USER', 'LOGNAME', 'PATH', 'LANG', 'TMPDIR')})

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        for server in cls.servers: server.shutdown(); server.server_close()
        for thread in cls.threads: thread.join(timeout=3)

    def setUp(self):
        self.requests.clear(); self.routes.clear()
        self.route('/json', payload={'fixture': True})

    def tearDown(self):
        self.assertEqual(self.browser.contexts, [], 'Fixture context leaked')

    def route(self, path, *, status=200, headers=None, payload=None, delay=0):
        self.routes[path] = (status, headers or {'Content-Type': 'application/json'},
                            json.dumps(payload).encode() if payload is not None else b'', delay)

    def navigate(self, path, *, limit=0, allowed=(), timeout=3000):
        context = self.browser.new_context(service_workers='block')
        page = context.new_page()
        guard = navigation.NavigationGuard(context, page, self.base + path, 'options_SPY',
                    redirect_limit=limit, allowed_redirects=[self.base+p for p in allowed])
        try:
            response = guard.goto(timeout)
            status = response.status if response else None
            body = response.body() if response else None
        finally:
            page.close()
            guard.close()
            context.close()
        return status, body, guard

    def test_successful_json_and_accounting(self):
        status, body, guard = self.navigate('/json')
        self.assertEqual(status, 200); self.assertEqual(json.loads(body), {'fixture': True})
        self.assertEqual(guard.accounting(), {'label':'options_SPY','attempts':1,'statuses':[200],
            'redirects':0,'blocked_redirects':0,'blocked_requests':0,'complete':True})
        self.assertEqual([p for _,p in self.requests], ['/json'])

    def test_307_is_stopped_before_destination_with_default_zero_limit(self):
        self.route('/start', status=307, headers={'Location':'/json'})
        _, _, guard = self.navigate('/start', allowed=['/json'])
        self.assertEqual(guard.failure, {'error':'redirect','status':307})
        self.assertEqual([p for _,p in self.requests], ['/start'])
        self.assertEqual(guard.accounting()['attempts'], 1)
        self.assertEqual(guard.accounting()['statuses'], [307])
        self.assertEqual(guard.accounting()['blocked_redirects'], 1)

    def test_all_http_redirect_codes_enforce_zero_limit(self):
        for status in (301, 302, 303, 307, 308):
            with self.subTest(status=status):
                self.requests.clear()
                self.route('/start', status=status, headers={'Location':'/json'})
                _, _, guard = self.navigate('/start', allowed=['/json'])
                self.assertEqual(guard.failure, {'error':'redirect','status':status})
                self.assertEqual([p for _,p in self.requests], ['/start'])

    def test_explicit_same_origin_destination_and_positive_limit(self):
        self.route('/start', status=307, headers={'Location':'/json'})
        status, _, guard = self.navigate('/start', limit=1, allowed=['/json'])
        self.assertEqual(status, 200)
        self.assertEqual([p for _,p in self.requests], ['/start','/json'])
        self.assertEqual(guard.accounting()['statuses'], [307,200])
        self.assertEqual(guard.accounting()['attempts'], 2)
        self.assertEqual(guard.accounting()['redirects'], 1)

    def test_unapproved_same_origin_and_foreign_origin_never_requested(self):
        for location in ('/json', self.other+'/json', '/json?private-fixture=hidden', '//invalid.test/json'):
            with self.subTest(case=location.split('?')[0]):
                self.requests.clear()
                self.route('/start', status=307, headers={'Location':location})
                _, _, guard = self.navigate('/start', limit=2)
                self.assertEqual(guard.failure, {'error':'redirect','status':307})
                self.assertEqual([p for _,p in self.requests], ['/start'])
                self.assertNotIn('private-fixture', json.dumps(guard.accounting()))

    def test_redirect_loop_stops_at_budget_and_counts_every_hop(self):
        self.route('/loop', status=307, headers={'Location':'/loop'})
        for limit in (0, 1, 2):
            with self.subTest(limit=limit):
                self.requests.clear()
                _, _, guard = self.navigate('/loop', limit=limit)
                self.assertEqual(len(self.requests), limit+1)
                self.assertEqual(guard.accounting()['attempts'], limit+1)
                self.assertEqual(guard.accounting()['statuses'], [307]*(limit+1))
                self.assertEqual(guard.accounting()['redirects'], limit)
                self.assertEqual(guard.accounting()['blocked_redirects'], 1)

    def test_timeout_cleanup_and_incomplete_accounting(self):
        self.route('/slow', payload={}, delay=.3)
        _, _, guard = self.navigate('/slow', timeout=50)
        self.assertEqual(guard.failure, {'error':'browser'})
        self.assertFalse(guard.accounting()['complete'])
        self.assertEqual(guard.accounting()['attempts'], 1)

    def test_news_both_groups_preserve_schema_and_close_context(self):
        for group in (1,6): self.route(f'/news/{group}', payload={'news_list':[article()]})
        context = self.browser.new_context()
        with patch.object(self.pw.chromium, 'launch_persistent_context', return_value=context), \
                patch.object(sync_news, 'LIST_ENDPOINTS', [self.base+'/news/1',self.base+'/news/6']):
            result = news_browser._fetch_with_browser(self.pw, 'unused', headless=True)
        self.assertEqual(len(result['payloads']), 2)
        self.assertEqual([r['statuses'] for r in result['network']], [[200],[200]])
        self.assertTrue(all(local_fallback.normalize_news_row(p['news_list'][0]) for p in result['payloads']))
        self.assertEqual([p for _,p in self.requests], ['/news/1','/news/6'])

    def test_news_403_challenge_stops_without_second_feed_or_retry(self):
        self.route('/news/1', status=403, headers={'cf-mitigated':'challenge','Content-Type':'text/html'})
        context = self.browser.new_context()
        with patch.object(self.pw.chromium, 'launch_persistent_context', return_value=context), \
                patch.object(sync_news, 'LIST_ENDPOINTS', [self.base+'/news/1',self.base+'/news/6']):
            result = news_browser._fetch_with_browser(self.pw, 'unused', headless=True)
        self.assertEqual(result['error'], 'challenge')
        self.assertEqual(result['network'][0]['statuses'], [403])
        self.assertEqual([p for _,p in self.requests], ['/news/1'])

    def test_news_307_stops_before_redirect_destination_and_second_feed(self):
        self.route('/news/1', status=307, headers={'Location':'/json'})
        context = self.browser.new_context()
        with patch.object(self.pw.chromium, 'launch_persistent_context', return_value=context), \
                patch.object(sync_news, 'LIST_ENDPOINTS', [self.base+'/news/1',self.base+'/news/6']):
            result = news_browser._fetch_with_browser(self.pw, 'unused', headless=True)
        self.assertEqual(result['error'], 'redirect')
        self.assertEqual(result['network'][0]['statuses'], [307])
        self.assertEqual(result['network'][0]['attempts'], 1)
        self.assertEqual([p for _,p in self.requests], ['/news/1'])

    def options(self, ticker, *, path=None):
        engine = Mock()
        engine.new_context.side_effect = self.browser.new_context
        def guard(context, page, endpoint, label):
            self.assertEqual(endpoint, f'https://saveticker.com/api/stocks/api/v1/tickers/{ticker}/options')
            return navigation.NavigationGuard(context, page, self.base+(path or '/options/'+ticker), label)
        with patch.object(self.pw.chromium, 'launch', return_value=engine), \
                patch.object(options_browser, 'NavigationGuard', side_effect=guard):
            result = options_browser._fetch_with_browser(self.pw, ticker, 'local-fixture-only')
        engine.close.assert_called_once()
        return result

    def test_all_19_options_tickers_preserve_schema_and_cleanup(self):
        tickers = local_fallback.allowed_tickers()
        self.assertEqual(len(tickers), 19)
        for ticker in tickers:
            with self.subTest(ticker=ticker):
                payload = dict(source(), symbol=ticker)
                self.route('/options/'+ticker, payload=payload)
                result = self.options(ticker)
                self.assertEqual(result['payload'], payload)
                self.assertEqual(local_fallback.normalize_options(result['payload'], ticker)['symbol'], ticker)
                self.assertEqual(result['network'][0]['statuses'], [200])
                self.assertEqual(self.browser.contexts, [])
        self.assertEqual(len(self.requests), 19)

    def test_options_challenge_and_redirect_preserve_errors_and_cleanup(self):
        for status, headers, expected in ((403, {'cf-mitigated':'challenge'}, 'challenge'),
                                           (307, {'Location':'/json'}, 'redirect')):
            with self.subTest(status=status):
                self.requests.clear(); self.route('/failure', status=status, headers=headers)
                result = self.options('SPY', path='/failure')
                self.assertEqual(result['error'], expected)
                self.assertEqual(result['network'][0]['attempts'], 1)
                self.assertEqual(result['network'][0]['statuses'], [status])
                self.assertEqual([p for _,p in self.requests], ['/failure'])
                self.assertEqual(self.browser.contexts, [])


if __name__ == '__main__':
    unittest.main()
