"""Credential-free Mac News retrieval in a short-lived standard Chromium worker."""

import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
REQUEST_TIMEOUT_MS = 25000
WORKER_TIMEOUT_SECONDS = 90
MAX_RESPONSE_BYTES = 8 * 1024 * 1024


class NewsBrowserError(Exception):
    """Only safe, locally constructed diagnostics are exposed to the updater."""


def _stop_worker(process):
    # The driver and Chromium inherit the worker's dedicated process group.
    # Terminate the whole group on errors, including an interrupted parent run.
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=5)


def _terminate_run(signum, frame):
    # Let Python unwind the worker/profile cleanup when launchd stops this job.
    raise SystemExit(128 + signum)


def fetch_news_payloads():
    """Return both feeds atomically, without persisting credentials or browser state."""
    python = ROOT / '.venv/bin/python'
    if not python.is_file():
        raise NewsBrowserError('News browser: install Playwright and Chromium in the repository .venv.')
    # Do not pass service credentials, application tokens, or browser overrides.
    environment = {key: value for key, value in os.environ.items()
                   if key in ('HOME', 'USER', 'LOGNAME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL')}
    with tempfile.TemporaryDirectory(prefix='spyconverter-news-browser-') as directory:
        process = None
        previous_term = signal.signal(signal.SIGTERM, _terminate_run)
        try:
            process = subprocess.Popen(
                [str(python), '-B', str(Path(__file__).resolve()), '--worker', directory],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                cwd=directory, env=environment, start_new_session=True,
            )
            output, _ = process.communicate(timeout=WORKER_TIMEOUT_SECONDS)
            if process.returncode or len(output) > MAX_RESPONSE_BYTES * 2 + 4096:
                raise NewsBrowserError('News browser: worker failed; existing data preserved.')
            result = json.loads(output)
            if not isinstance(result, dict):
                raise ValueError('invalid worker result')
            if result.get('error'):
                code = result['error']
                group = result.get('group')
                label = f'News group {group}' if type(group) is int and group in (1, 6) else 'News browser'
                messages = {
                    'challenge': 'Cloudflare challenge; stopped without retry; existing data preserved.',
                    'http': 'HTTP request rejected; existing data preserved.',
                    'content': 'expected application/json; existing data preserved.',
                    'schema': 'invalid News JSON/schema; existing data preserved.',
                    'size': 'response exceeded size limit; existing data preserved.',
                    'browser': 'browser/network failure; check Playwright and Chromium installation; existing data preserved.',
                }
                message = messages.get(code, messages['browser']) if isinstance(code, str) else messages['browser']
                status = result.get('status')
                suffix = f' (HTTP {status})' if type(status) is int and 100 <= status <= 599 else ''
                raise NewsBrowserError(f'{label}: {message}{suffix}')
            payloads = result.get('payloads')
            if (not isinstance(payloads, list) or len(payloads) != 2
                    or any(not isinstance(p, dict) or not isinstance(p.get('news_list'), list)
                           for p in payloads)):
                raise ValueError('invalid worker result')
            return payloads
        except subprocess.TimeoutExpired:
            raise NewsBrowserError('News browser: 90-second timeout; existing data preserved.') from None
        except (OSError, ValueError):
            raise NewsBrowserError('News browser: worker unavailable or invalid result; existing data preserved.') from None
        finally:
            try:
                if process is not None:
                    _stop_worker(process)
            finally:
                signal.signal(signal.SIGTERM, previous_term)


def _article_metadata(item):
    # Preserve every input consumed by existing normalization; omit article
    # bodies and unrelated upstream fields from the in-memory worker pipe.
    fields = ('id', 'source', 'title', 'created_at', 'tickers', 'is_headline_only')
    result = {key: item[key] for key in fields if key in item}
    extra = item.get('extra')
    if isinstance(extra, dict):
        result['extra'] = {'source_created_at': extra.get('source_created_at')}
    translations = item.get('translations')
    translated = translations.get('translated') if isinstance(translations, dict) else None
    english = translated.get('en_US') if isinstance(translated, dict) else None
    if isinstance(english, dict):
        result['translations'] = {'translated': {'en_US': {'title': english.get('title')}}}
    return result


def _fetch_with_browser(playwright, profile, *, headless=False):
    from sync_news import LIST_ENDPOINTS

    context = playwright.chromium.launch_persistent_context(
        profile, headless=headless, timeout=REQUEST_TIMEOUT_MS,
    )
    try:
        payloads = []
        for group, endpoint in zip((1, 6), LIST_ENDPOINTS):
            page = context.new_page()
            page.set_default_timeout(REQUEST_TIMEOUT_MS)
            try:
                response = page.goto(endpoint, wait_until='commit', timeout=REQUEST_TIMEOUT_MS)
                if response is None:
                    return {'error': 'browser', 'group': group}
                status = response.status
                if (response.header_value('cf-mitigated') or '').lower() == 'challenge':
                    return {'error': 'challenge', 'group': group, 'status': status}
                if status != 200:
                    return {'error': 'http', 'group': group, 'status': status}
                kind = (response.header_value('content-type') or '').split(';', 1)[0].strip().lower()
                if kind != 'application/json':
                    return {'error': 'content', 'group': group, 'status': status}
                body = response.body()
                if len(body) > MAX_RESPONSE_BYTES:
                    return {'error': 'size', 'group': group}
                try:
                    payload = json.loads(body)
                except (ValueError, UnicodeError):
                    return {'error': 'schema', 'group': group}
                if not isinstance(payload, dict) or not isinstance(payload.get('news_list'), list):
                    return {'error': 'schema', 'group': group}
                payloads.append({'news_list': [_article_metadata(item) for item in payload['news_list']
                                              if isinstance(item, dict)]})
            finally:
                page.close()
        return {'payloads': payloads}
    finally:
        context.close()


def _worker(profile):
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as playwright:
            return _fetch_with_browser(playwright, profile)
    except Exception:
        # Never expose browser exception strings, headers, bodies, or traces.
        return {'error': 'browser'}


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] != '--worker':
        sys.exit('Internal News worker; run local_fallback.py instead.')
    print(json.dumps(_worker(sys.argv[2]), allow_nan=False), flush=True)
