"""Opt-in macOS headed Chromium without activating its application or pages.

The native supervisor owns the LaunchServices PID (outside the worker's process
group), including if the Python worker is killed. No visible-launch retry exists.
"""

import argparse
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / '.local-fallback'
SOURCE = Path(__file__).with_name('background_browser.swift')
CONFIG = STATE / 'background-browser.json'
TESTED_PLAYWRIGHT = '1.63.0'


class BackgroundBrowserError(Exception):
    pass


def settings():
    try:
        value = json.loads(CONFIG.read_text())
    except FileNotFoundError:
        return {'news': False, 'options': False}
    # Invalid configuration fails closed instead of unexpectedly opening windows.
    if (not isinstance(value, dict) or set(value) != {'news', 'options'}
            or any(type(v) is not bool for v in value.values())):
        raise BackgroundBrowserError('Invalid background-browser settings.')
    return value


def enabled(component):
    return settings()[component]


def helper_path():
    digest = hashlib.sha256(SOURCE.read_bytes()).hexdigest()[:20]
    return STATE / 'native' / ('background-browser-' + digest)


def prepare():
    if sys.platform != 'darwin':
        raise BackgroundBrowserError('Background Chromium requires macOS.')
    target = helper_path()
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    sdk = subprocess.run(['xcrun', '--show-sdk-path'], capture_output=True, text=True, timeout=15)
    if sdk.returncode:
        raise BackgroundBrowserError('Install Apple command line tools before preparing the helper.')
    result = subprocess.run(['xcrun', 'swiftc', '-sdk', sdk.stdout.strip(),
                             '-module-cache-path', str(target.parent / 'swift-cache'),
                             str(SOURCE), '-o', str(target) + '.tmp'],
                            capture_output=True, timeout=120)
    if result.returncode:
        raise BackgroundBrowserError('Native helper compilation failed; no browser mode changed.')
    os.replace(str(target) + '.tmp', target)
    return target


def configure(component, value):
    if value and not helper_path().is_file():
        raise BackgroundBrowserError('Run prepare and verify locally before enabling background mode.')
    config = settings()
    config[component] = value
    STATE.mkdir(mode=0o700, exist_ok=True)
    descriptor, name = tempfile.mkstemp(dir=STATE, prefix='browser-config-')
    try:
        with os.fdopen(descriptor, 'w') as handle:
            json.dump(config, handle)
        os.replace(name, CONFIG)
    finally:
        Path(name).unlink(missing_ok=True)


def default_arguments(profile):
    # Match the installed, verified Playwright defaults rather than a spoofed
    # browser identity. A dependency upgrade requires re-verification first.
    if version('playwright') != TESTED_PLAYWRIGHT:
        raise BackgroundBrowserError('Playwright version changed; reverify background Chromium.')
    import playwright
    source = (Path(playwright.__file__).parent / 'driver/package/lib/coreBundle.js').read_text()
    switches = source.split('chromiumSwitches = (options) => [', 1)[1].split('].filter(Boolean)', 1)[0]
    defaults = [s for s in re.findall(r'"(--[^"\n]+)"', switches) if s != '--disable-features=']
    features = source.split('    disabledFeatures = [', 1)[1].split('].filter(Boolean)', 1)[0]
    disabled = re.findall(r'^\s+"([^"\n]+)"', features, re.M)
    required = {'--use-mock-keychain', '--password-store=basic', '--no-first-run',
                '--disable-background-networking', '--disable-component-update'}
    if not required.issubset(defaults) or not disabled:
        raise BackgroundBrowserError('Unrecognized Playwright launch defaults.')
    return defaults + ['--disable-features=' + ','.join(disabled),
        '--enable-unsafe-swiftshader', '--no-sandbox', f'--user-data-dir={profile}',
        '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
        '--no-startup-window', '--disable-quic']


class BackgroundBrowser:
    def __init__(self, playwright, component, *, local_only=False):
        if sys.platform != 'darwin' or component not in ('news', 'options'):
            raise BackgroundBrowserError('Unsupported background browser configuration.')
        self.directory = Path(tempfile.mkdtemp(prefix='spy-bg-', dir='/private/tmp'))
        self.profile = self.directory / 'profile'
        self.profile.mkdir(mode=0o700)
        self.component = component
        self.browser = self.session = self.helper = None
        self.context_ids = {}
        self.closed = False
        try:
            helper = helper_path()
            if not helper.is_file():
                raise BackgroundBrowserError('Background helper missing; run prepare first.')
            executable = Path(playwright.chromium.executable_path)
            app = next(p for p in executable.parents if p.suffix == '.app')
            arguments = default_arguments(self.profile)
            if local_only:
                arguments += ['--proxy-server=http://127.0.0.1:9',
                    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1']
            STATE.mkdir(mode=0o700, exist_ok=True)
            config = {'app': str(app), 'arguments': arguments, 'worker_pid': os.getpid(),
                      'owner_pid': os.getppid(), 'watchdog_seconds': 80 if component == 'news' else 50,
                      'report': str(STATE / f'background-{component}-last.json')}
            (self.directory / 'launch.json').write_text(json.dumps(config))
            environment = {k: v for k, v in os.environ.items()
                           if k in ('HOME', 'USER', 'LOGNAME', 'PATH', 'LANG', 'LC_ALL')}
            self.helper = subprocess.Popen([str(helper), '--worker', str(self.directory)],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                env=environment, start_new_session=True)
            deadline = time.monotonic() + 15
            while not (self.profile / 'DevToolsActivePort').exists() or not (self.directory / 'launched.json').exists():
                self.check()
                if time.monotonic() > deadline:
                    raise BackgroundBrowserError('Background browser startup timed out.')
                time.sleep(.03)
            self.check()
            port = int((self.profile / 'DevToolsActivePort').read_text().splitlines()[0])
            if not 1 <= port <= 65535:
                raise BackgroundBrowserError('Invalid local debugging endpoint.')
            self.browser = playwright.chromium.connect_over_cdp(f'http://127.0.0.1:{port}', timeout=10000)
            self.session = self.browser.new_browser_cdp_session()
            self.context = self.browser.contexts[0]
            self.context_ids[id(self.context)] = None
            # Closing the final window before Browser.close can activate Chromium.
            self.sentinel = self.new_page(self.context)
            (self.directory / 'hide').touch()
            time.sleep(.2)
            self.check()
        except BaseException:
            self.close()
            raise

    def check(self):
        if (self.directory / 'focus-failure').exists():
            raise BackgroundBrowserError('Background browser desktop guard stopped this worker.')
        if self.helper is not None and self.helper.poll() is not None:
            raise BackgroundBrowserError('Background browser supervisor exited.')

    def new_context(self, **kwargs):
        self.check()
        before = set(self.session.send('Target.getBrowserContexts')['browserContextIds'])
        context = self.browser.new_context(**kwargs)
        after = set(self.session.send('Target.getBrowserContexts')['browserContextIds'])
        context_id, = after - before
        self.context_ids[id(context)] = context_id
        return context

    def new_page(self, context):
        self.check()
        params = {'url': 'about:blank', 'background': True, 'focus': False}
        context_id = self.context_ids[id(context)]
        if context_id is not None:
            params['browserContextId'] = context_id
        target = self.session.send('Target.createTarget', params)['targetId']
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            self.check()
            for page in context.pages:
                session = context.new_cdp_session(page)
                try:
                    info = session.send('Target.getTargetInfo')['targetInfo']
                finally:
                    session.detach()
                if info['targetId'] == target:
                    return page
            self.session.send('Target.getTargets')
            time.sleep(.02)
        raise BackgroundBrowserError('Background page was not adopted by Playwright.')

    def close(self):
        if self.closed:
            return
        self.closed = True
        if self.session is not None:
            try:
                self.session.send('Browser.close')
            except Exception:
                pass
        if self.browser is not None:
            try:
                self.browser.close()
            except Exception:
                pass
        try:
            if self.helper is not None:
                (self.directory / 'stop').touch()
                # Do not kill the independent supervisor: it still owns cleanup.
                self.helper.wait(timeout=8)
                report = json.loads((self.directory / 'monitor.json').read_text())
                if (not report['browser_terminated'] or report['browser_activation_events']
                        or report['maximum_visible_windows'] or report['space_change_events']
                        or report['stop_reason'] != 'requested_cleanup'):
                    raise BackgroundBrowserError('Background browser failed desktop/cleanup verification.')
        finally:
            # The native supervisor removes the profile even after worker SIGKILL.
            if self.helper is None or self.helper.poll() is not None:
                shutil.rmtree(self.directory, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('prepare', 'status', 'enable', 'disable'))
    parser.add_argument('component', nargs='?', choices=('news', 'options'))
    args = parser.parse_args()
    try:
        if args.command == 'prepare':
            prepare()
        elif args.command in ('enable', 'disable'):
            if not args.component:
                parser.error('Choose news or options.')
            configure(args.component, args.command == 'enable')
        config = settings()
        for key in ('news', 'options'):
            print(f"{key}: {'background' if config[key] else 'original headed'}")
        return 0
    except Exception:
        print('Background browser configuration failed; no sensitive diagnostics logged.')
        return 1


if __name__ == '__main__':
    sys.exit(main())
