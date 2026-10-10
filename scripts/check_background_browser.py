"""Explicit local-fixture lifecycle checks; never load credentials or contact APIs."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from unittest.mock import patch

import background_browser as bg
import local_fallback
import news_browser
import options_browser
from test_local_fallback import article
from test_options_browser import source


def worker(directory, kind, ticker, fault):
    from playwright.sync_api import sync_playwright
    bg.STATE = directory
    real_launcher = bg.BackgroundBrowser
    helper_binary = bg.helper_path()
    # helper_path depends on STATE; the executable is prepared in the repo.
    helper_binary = bg.ROOT / '.local-fallback/native' / helper_binary.name
    launched = []
    count = 0

    def factory(playwright, component):
        nonlocal count
        if fault == 'startup':
            real_temporary = bg.tempfile.mkdtemp
            def temporary_profile(**kwargs):
                name = real_temporary(**kwargs)
                (directory / 'profile-path').write_text(name)
                return name
            with patch.object(bg.tempfile, 'mkdtemp', side_effect=temporary_profile), \
                    patch.object(playwright.chromium, 'connect_over_cdp', side_effect=RuntimeError('injected CDP startup failure')):
                return real_launcher(playwright, component, local_only=True)
        engine = real_launcher(playwright, component, local_only=True)
        launched.append(engine)
        (directory / 'profile-path').write_text(str(engine.directory))

        def fixtures(route):
            nonlocal count
            request = route.request
            valid = (request.resource_type == 'document' and request.redirected_from is None
                     and (request.url in local_fallback.LIST_ENDPOINTS if kind == 'news' else
                          request.url == f'https://saveticker.com/api/stocks/api/v1/tickers/{ticker}/options'))
            if not valid:
                route.abort(); return
            count += 1
            if fault == 'timeout':
                return  # intentionally unresolved interception: real navigation timeout
            payload = {'news_list': [article()]} if kind == 'news' else dict(source(), symbol=ticker)
            route.fulfill(status=200, content_type='application/json', body=json.dumps(payload))

        if kind == 'news':
            engine.context.route('**/*', fixtures)
        else:
            original_context = engine.new_context

            def create_context(**kwargs):
                context = original_context(**kwargs)
                real_route = context.route
                # Worker installs its usual exact-endpoint policy; fixture responses
                # replace transmission. Existing unit tests verify that policy.
                context.route = lambda pattern, handler: real_route(pattern, fixtures)
                return context
            engine.new_context = create_context
        original_page = engine.new_page

        def create_page(context):
            page = original_page(context)
            goto = page.goto

            def navigate(url, **kwargs):
                if fault == 'exception':
                    raise RuntimeError('injected local exception')
                if fault == 'timeout':
                    kwargs['timeout'] = 150
                response = goto(url, **kwargs)
                if not fault:
                    for _ in range(2):
                        response.body()
                        page.wait_for_load_state('load', timeout=25000)
                        response = page.reload(wait_until='commit', timeout=25000)
                if fault in ('sigterm', 'sigkill'):
                    (directory / 'ready-to-kill').touch()
                    while True:
                        time.sleep(.05)
                return response
            page.goto = navigate
            return page
        engine.new_page = create_page
        return engine

    result = {'kind': kind, 'ticker': ticker, 'fault': fault, 'live_requests': 0}
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(SystemExit(143)))
    try:
        with patch.object(bg, 'helper_path', return_value=helper_binary), \
                patch.object(bg, 'BackgroundBrowser', side_effect=factory), sync_playwright() as playwright:
            if kind == 'news':
                payload = news_browser._fetch_with_browser(playwright, 'unused', background=True)
                result['schema_ok'] = (len(payload.get('payloads', [])) == 2 and
                    all(local_fallback.normalize_news_row(p['news_list'][0]) for p in payload['payloads']))
            else:
                payload = options_browser._fetch_with_browser(playwright, ticker, 'local-fixture-only', background=True)
                normalized = local_fallback.normalize_options(payload['payload'], ticker)
                result['schema_ok'] = normalized['symbol'] == ticker and 'gammaUpdatedAt' in payload['payload']
    except BaseException as error:
        result['error_type'] = type(error).__name__
    result['fixture_requests'] = count
    result['work_ok'] = bool(result.get('schema_ok')) if not fault else bool(result.get('error_type'))
    print(json.dumps(result), flush=True)


def run_case(root, kind, ticker=None, fault=None):
    with tempfile.TemporaryDirectory(prefix='case-', dir=root) as temporary:
        directory = Path(temporary)
        args = [sys.executable, '-B', str(Path(__file__).resolve()), '--local-only', '--worker',
                str(directory), '--kind', kind]
        if ticker:
            args += ['--ticker', ticker]
        if fault:
            args += ['--fault', fault]
        environment = {k: v for k, v in os.environ.items()
                       if k in ('HOME', 'USER', 'LOGNAME', 'PATH', 'LANG', 'LC_ALL')}
        process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, env=environment, start_new_session=True)
        result = {'kind': kind, 'ticker': ticker, 'fault': fault, 'live_requests': 0}
        try:
            if fault in ('sigterm', 'sigkill'):
                deadline = time.monotonic() + 30
                while not (directory / 'ready-to-kill').exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(.03)
                if (directory / 'ready-to-kill').exists():
                    os.killpg(process.pid, signal.SIGKILL if fault == 'sigkill' else signal.SIGTERM)
                    if fault == 'sigterm':
                        try:
                            process.wait(timeout=2)
                        except subprocess.TimeoutExpired:
                            os.killpg(process.pid, signal.SIGKILL)
                    result['work_ok'] = True
            output, _ = process.communicate(timeout=90 if kind == 'news' else 60)
            if output:
                result.update(json.loads(output))
        finally:
            if process.poll() is None:
                news_browser._stop_worker(process)
        report_file = directory / f'background-{kind}-last.json'
        deadline = time.monotonic() + 10
        while not report_file.exists() and time.monotonic() < deadline:
            time.sleep(.05)
        report = json.loads(report_file.read_text()) if report_file.exists() else {}
        result['monitor'] = report
        profile_file = directory / 'profile-path'
        profile = Path(profile_file.read_text()) if profile_file.exists() else None
        rows = subprocess.check_output(['ps', '-axo', 'command='], text=True)
        result['processes_remaining'] = bool(profile and any(str(profile) in row for row in rows.splitlines()))
        result['temporary_directory_removed'] = bool(profile and not profile.exists())
        result['passed'] = bool(result.get('work_ok') and report.get('browser_terminated')
            and report.get('profile_removed') and report.get('browser_activation_events') == 0
            and report.get('maximum_visible_windows') == 0 and report.get('space_change_events') == 0
            and not result['processes_remaining'] and result['temporary_directory_removed'])
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--local-only', action='store_true', required=True)
    parser.add_argument('--suite', choices=('smoke', 'all', 'recovery'), default='smoke')
    parser.add_argument('--worker', type=Path)
    parser.add_argument('--kind', choices=('news', 'options'))
    parser.add_argument('--ticker')
    parser.add_argument('--fault', choices=('startup', 'exception', 'timeout', 'sigterm', 'sigkill'))
    args = parser.parse_args()
    if args.worker:
        worker(args.worker, args.kind, args.ticker, args.fault)
        return 0
    if args.suite == 'all':
        specs = [('news', None, None)] + [('options', t, None) for t in local_fallback.allowed_tickers()]
    elif args.suite == 'recovery':
        specs = [(k, 'SPY' if k == 'options' else None, f) for k in ('news', 'options')
                 for f in ('startup', 'exception', 'timeout', 'sigterm', 'sigkill')]
    else:
        specs = [('news', None, None), ('options', 'SPY', None)]
    results = []
    with tempfile.TemporaryDirectory(prefix='spy-bg-check-', dir='/private/tmp') as directory:
        for spec in specs:
            result = run_case(Path(directory), *spec)
            results.append(result)
            print(json.dumps(result), flush=True)
            if not result['passed']:
                break
    destination = bg.STATE / 'background-rollout'
    destination.mkdir(parents=True, mode=0o700, exist_ok=True)
    (destination / f'local-{args.suite}.json').write_text(json.dumps(results, indent=2))
    return 0 if len(results) == len(specs) and all(r['passed'] for r in results) else 1


if __name__ == '__main__':
    sys.exit(main())
