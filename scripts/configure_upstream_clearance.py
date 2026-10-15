#!/usr/bin/env python3
"""Import one user-copied SaveTicker cookie for isolated verification only.

This helper never reads Chrome's encryption key, cookie database, or profile.
It does not enable the cookie in production or make any network requests.
"""

import getpass
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
import warnings

from configure_upstream_token import _clear_token_clipboard

ROOT = Path(__file__).resolve().parents[1]
RELATIVE = Path('.local-fallback/saveticker-clearance.json')
MAX_AGE_SECONDS = 24 * 60 * 60


class ClearanceError(Exception):
    """Only constant, secret-free messages may be used here."""


def validate_value(value):
    # A value, never a Cookie header, cookie table, JSON export, or shell command.
    if (not isinstance(value, str) or not 16 <= len(value) <= 4096
            or value.startswith(('cf_clearance=', 'access_token=', 'Cookie:'))
            or not re.fullmatch(r'[A-Za-z0-9._~+/=-]+', value)):
        raise ClearanceError('Paste only the cf_clearance cookie value; nothing was saved.')
    return value


def verify_location():
    for command, good in ((['git', 'check-ignore', '--quiet', str(RELATIVE)], 0),
                          (['git', 'ls-files', '--error-unmatch', str(RELATIVE)], 1)):
        result = subprocess.run(command, cwd=ROOT, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, timeout=5)
        if result.returncode != good:
            raise ClearanceError('The local cookie file must be Git-ignored and untracked.')
    directory = ROOT / RELATIVE.parent
    target = ROOT / RELATIVE
    if directory.is_symlink() or target.is_symlink():
        raise ClearanceError('Refusing a symbolic link for the private cookie file.')
    return target


def save_cookie(value):
    value = validate_value(value)
    target = verify_location()
    target.parent.mkdir(mode=0o700, exist_ok=True)
    record = {'version': 1, 'imported_at': time.time(), 'cookie': {
        'name': 'cf_clearance', 'value': value, 'domain': '.saveticker.com',
        'path': '/', 'httpOnly': True, 'secure': True, 'sameSite': 'None'}}
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=target.parent,
                                         prefix='clearance-', delete=False) as handle:
            temporary = Path(handle.name)
            os.fchmod(handle.fileno(), 0o600)
            json.dump(record, handle, allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def load_cookie_for_verification():
    """Return only the allowlisted cookie; never log this return value."""
    target = ROOT / RELATIVE
    if target.parent.is_symlink():
        raise ClearanceError('Private cookie directory must not be a symbolic link.')
    try:
        descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor) as handle:
            info = os.fstat(handle.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                    or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 8192):
                raise ClearanceError('Private cookie file requires owner-only permissions.')
            record = json.load(handle)
        if (not isinstance(record, dict) or set(record) != {'version', 'imported_at', 'cookie'}
                or record['version'] != 1 or type(record['imported_at']) not in (int, float)
                or not 0 <= time.time() - record['imported_at'] <= MAX_AGE_SECONDS):
            raise ClearanceError('Import a fresh cookie before isolated verification.')
        cookie = record['cookie']
        expected = {'name': 'cf_clearance', 'domain': '.saveticker.com', 'path': '/',
                    'httpOnly': True, 'secure': True, 'sameSite': 'None'}
        if (not isinstance(cookie, dict) or set(cookie) != set(expected) | {'value'}
                or any(type(cookie[k]) is not type(v) or cookie[k] != v
                       for k, v in expected.items())):
            raise ClearanceError('Invalid SaveTicker cookie scope.')
        validate_value(cookie['value'])
        return cookie
    except ClearanceError:
        raise
    except Exception:
        raise ClearanceError('Private cookie unavailable; run the local import helper.') from None


def main():
    if len(sys.argv) != 1 or not sys.stdin.isatty():
        raise ClearanceError('Run this helper without arguments in an interactive Terminal.')
    verify_location()
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        value = getpass.getpass('Paste only the SaveTicker cf_clearance value (hidden): ').strip()
    save_cookie(value)
    _clear_token_clipboard(value)
    print('Saved one cookie in private, Git-ignored .local-fallback/saveticker-clearance.json.')
    print('Ready for isolated verification. Production remains unchanged; no API requests made.')


if __name__ == '__main__':
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print('Cancelled; no production changes.', file=sys.stderr)
        sys.exit(1)
    except ClearanceError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('Cookie import failed; no sensitive diagnostics logged.', file=sys.stderr)
        sys.exit(1)
