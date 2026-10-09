"""Mac Options retrieval with one isolated Chromium context per ticker."""

import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile

from news_browser import _stop_worker, _terminate_run

ROOT = Path(__file__).resolve().parents[1]
REQUEST_TIMEOUT_MS = 25000
WORKER_TIMEOUT_SECONDS = 60
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_INPUT_BYTES = 65536


class OptionsBrowserError(Exception):
    """Only locally constructed diagnostics may leave the browser worker."""


def _valid_input(ticker, token):
    return (isinstance(ticker, str) and re.fullmatch(r'[A-Z]{1,5}', ticker)
            and isinstance(token, str) and len(token) < MAX_INPUT_BYTES // 2
            and not token.startswith(('access_token=', 'cf_clearance='))
            and re.fullmatch(r'[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+', token))


def fetch_options_payload(ticker, token):
    if not _valid_input(ticker, token):
        raise OptionsBrowserError('Options browser: invalid ticker or application token configuration.')
    python = ROOT / '.venv/bin/python'
    if not python.is_file():
        raise OptionsBrowserError('Options browser: install Playwright and Chromium in the repository .venv.')
    environment = {key: value for key, value in os.environ.items()
                   if key in ('HOME', 'USER', 'LOGNAME', 'PATH', 'LANG', 'LC_ALL')}
    with tempfile.TemporaryDirectory(prefix='spyconverter-options-worker-') as directory:
        # Browser temporary files stay within this private, disposable directory.
        environment['TMPDIR'] = directory
        process = None
        previous_term = signal.signal(signal.SIGTERM, _terminate_run)
        try:
            process = subprocess.Popen(
                [str(python), '-B', str(Path(__file__).resolve()), '--worker'],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                cwd=directory, env=environment, start_new_session=True,
            )
            # The token travels only through a private pipe, never argv/env/files.
            output, _ = process.communicate(
                json.dumps({'ticker': ticker, 'token': token}).encode(),
                timeout=WORKER_TIMEOUT_SECONDS,
            )
            if process.returncode or len(output) > MAX_RESPONSE_BYTES + 4096:
                raise OptionsBrowserError(f'Options {ticker}: browser worker failed; existing data preserved.')
            result = json.loads(output)
            if not isinstance(result, dict):
                raise ValueError('invalid worker result')
            if result.get('error'):
                messages = {
                    'challenge': 'Cloudflare challenge; stopped without retry',
                    'http': 'HTTP request rejected',
                    'content': 'expected application/json',
                    'schema': 'invalid Options JSON/schema',
                    'size': 'response exceeded size limit',
                    'browser': 'browser/network failure; check Playwright and Chromium installation',
                }
                code = result['error']
                message = messages.get(code, messages['browser']) if isinstance(code, str) else messages['browser']
                status = result.get('status')
                suffix = f' (HTTP {status})' if type(status) is int and 100 <= status <= 599 else ''
                raise OptionsBrowserError(f'Options {ticker}: {message}{suffix}; existing data preserved.')
            payload = result.get('payload')
            if not isinstance(payload, dict):
                raise ValueError('invalid worker result')
            return payload
        except subprocess.TimeoutExpired:
            raise OptionsBrowserError(f'Options {ticker}: 60-second browser timeout; existing data preserved.') from None
        except (OSError, ValueError):
            raise OptionsBrowserError(f'Options {ticker}: browser unavailable or invalid result; existing data preserved.') from None
        finally:
            try:
                if process is not None:
                    _stop_worker(process)
            finally:
                signal.signal(signal.SIGTERM, previous_term)


def _fetch_with_browser(playwright, ticker, token):
    from sync_direct import validate_source_payload

    endpoint = f'https://saveticker.com/api/stocks/api/v1/tickers/{ticker}/options'
    browser = playwright.chromium.launch(headless=False, timeout=REQUEST_TIMEOUT_MS)
    try:
        context = browser.new_context(accept_downloads=False, service_workers='block')
        try:
            # Non-persistent context: no session/profile import and no cookie file.
            context.add_cookies([{'name': 'access_token', 'value': token,
                                 'url': 'https://saveticker.com', 'httpOnly': True,
                                 'secure': True, 'sameSite': 'Lax'}])

            def route_request(route):
                request = route.request
                # One exact API navigation only; no redirects, analytics, or resources.
                if (request.url == endpoint and request.resource_type == 'document'
                        and request.redirected_from is None):
                    route.continue_()
                else:
                    route.abort()

            context.route('**/*', route_request)
            page = context.new_page()
            page.set_default_timeout(REQUEST_TIMEOUT_MS)
            response = page.goto(endpoint, wait_until='commit', timeout=REQUEST_TIMEOUT_MS)
            if response is None:
                return {'error': 'browser'}
            status = response.status
            if (response.header_value('cf-mitigated') or '').lower() == 'challenge':
                return {'error': 'challenge', 'status': status}
            if status != 200:
                return {'error': 'http', 'status': status}
            kind = (response.header_value('content-type') or '').split(';', 1)[0].strip().lower()
            if kind != 'application/json':
                return {'error': 'content', 'status': status}
            body = response.body()
            if len(body) > MAX_RESPONSE_BYTES:
                return {'error': 'size'}
            try:
                payload = json.loads(body)
                validate_source_payload(payload, ticker)
                json.dumps(payload, allow_nan=False)
            except (ValueError, TypeError, OverflowError, AttributeError):
                return {'error': 'schema'}
            return {'payload': payload}
        finally:
            context.close()
    finally:
        browser.close()


def _worker():
    try:
        request = json.loads(sys.stdin.buffer.read(MAX_INPUT_BYTES + 1))
        if not isinstance(request, dict) or not _valid_input(request.get('ticker'), request.get('token')):
            return {'error': 'browser'}
        from playwright.sync_api import sync_playwright
        with sync_playwright() as playwright:
            return _fetch_with_browser(playwright, request['ticker'], request['token'])
    except Exception:
        return {'error': 'browser'}


if __name__ == '__main__':
    if sys.argv[1:] != ['--worker']:
        sys.exit('Internal Options worker; run local_fallback.py instead.')
    print(json.dumps(_worker(), allow_nan=False), flush=True)
