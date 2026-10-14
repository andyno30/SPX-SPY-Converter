#!/usr/bin/env python3
"""Import pasted/saved SaveTicker JSON without fetching from SaveTicker."""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import io
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile

import local_fallback as fallback
from local_fallback_permissions import make_private
from options_revisions import OptionsPayload, OptionsRevisions
from sync_direct import normalize, validate_source_payload

MAX_BYTES = 8 * 1024 * 1024
MAX_DOCUMENTS = 100
ARCHIVE = fallback.ROOT / '.local-fallback/manual-imports'


@dataclass
class Prepared:
    label: str
    kind: str
    payload: dict | None = None
    rows: list[dict] = field(default_factory=list)
    skipped: int = 0


@dataclass
class Report:
    label: str
    inserted: int = 0
    updated: int = 0
    skipped: int = 0
    errors: int = 0
    would_insert: int = 0
    would_update: int = 0
    detail: str = ''

    def line(self):
        counts = ', '.join(f'{name}={getattr(self, name)}' for name in
                           ('inserted', 'updated', 'skipped', 'errors', 'would_insert', 'would_update')
                           if getattr(self, name) or name in ('inserted', 'updated', 'skipped', 'errors'))
        return f'{self.label}: {counts}' + (f'; {self.detail}' if self.detail else '')


def utcnow():
    return datetime.now(timezone.utc)


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON key')
        result[key] = value
    return result


def _reject_constant(value):
    raise ValueError('Non-finite JSON number')


def _strict_json_location(text):
    """Locate duplicate keys/non-finite numbers without returning input contents.

    The standard decoder remains authoritative. This scan runs only after its
    strict hooks or finite-number check reject input without a source position.
    Quoted strings are one token, so their contents cannot be mistaken for keys,
    nesting, or numeric literals.
    """
    tokens = re.finditer(r'"(?:\\.|[^"\\])*"|[{}\[\],:]|'
                         r'-?(?:Infinity|NaN|(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)', text)
    stack = []
    for token in tokens:
        value = token.group()
        if value == '{':
            stack.append({'keys': set(), 'expect_key': True})
        elif value == '[':
            stack.append(None)
        elif value in ('}', ']'):
            if stack:
                stack.pop()
        elif value == ',':
            if stack and stack[-1] is not None:
                stack[-1]['expect_key'] = True
        elif value.startswith('"'):
            if stack and stack[-1] is not None and stack[-1]['expect_key']:
                key = json.loads(value)
                if key in stack[-1]['keys']:
                    return token.start(), 'Duplicate object key'
                stack[-1]['keys'].add(key)
                stack[-1]['expect_key'] = False
        elif value != ':':
            if any(c in value for c in '.eE') or value in ('NaN', 'Infinity', '-Infinity'):
                if not math.isfinite(float(value)):
                    return token.start(), 'Non-finite number is not allowed'
            elif (limit := getattr(sys, 'get_int_max_str_digits', lambda: 0)()):
                if len(value.lstrip('-')) > limit:
                    return token.start(), 'Integer exceeds the JSON parser limit'
    return None


def _json_error(text, position, reason):
    line = text.count('\n', 0, position) + 1
    column = position - text.rfind('\n', 0, position)
    # Never include a source excerpt, key, value or arbitrary exception string.
    return fallback.SafeError(f'Invalid JSON at line {line}, column {column}: '
                              f'{reason}. No data imported.')


def decode(text):
    if len(text.encode('utf-8')) > MAX_BYTES:
        raise fallback.SafeError('Input exceeds the 8 MiB limit; no data imported.')
    text = text.lstrip('\ufeff')
    try:
        value = json.loads(text, object_pairs_hook=_unique_object,
                           parse_constant=_reject_constant)
        # Reject overflow such as 1e999 as well as literal NaN/Infinity.
        json.dumps(value, allow_nan=False)
    except json.JSONDecodeError as error:
        reasons = {
            'Expecting value', 'Expecting property name enclosed in double quotes',
            "Expecting ':' delimiter", "Expecting ',' delimiter", 'Extra data',
            'Unterminated string starting at', 'Invalid \\escape',
            'Invalid \\uXXXX escape', 'Invalid control character at',
        }
        reason = error.msg if error.msg in reasons else 'Invalid JSON syntax'
        raise _json_error(text, error.pos, reason) from None
    except ValueError:
        location = _strict_json_location(text)
        if location is not None:
            raise _json_error(text, *location) from None
        raise fallback.SafeError('Invalid JSON; parser limit exceeded. No data imported.') from None
    except (UnicodeError, OverflowError, RecursionError):
        raise fallback.SafeError('Invalid JSON; encoding or parser limit exceeded. No data imported.') from None
    documents = value if isinstance(value, list) else [value]
    if not documents or len(documents) > MAX_DOCUMENTS or any(not isinstance(d, dict) for d in documents):
        raise fallback.SafeError('Expected one JSON object or an array of up to 100 response objects.')
    return documents


def prepare(raw, label, tickers, now):
    if 'news_list' in raw:
        if not isinstance(raw['news_list'], list) or 'symbol' in raw:
            raise fallback.SafeError('Invalid News response structure; no data imported.')
        rows, skipped = {}, 0
        for article in raw['news_list']:
            try:
                row = fallback.normalize_news_row(article) if isinstance(article, dict) else None
                published = fallback.timestamp(row['published_at']) if row else None
            except (ValueError, TypeError, AttributeError, OverflowError):
                row = None
                published = None
            if (not row or row['source'] not in fallback.SOURCE_LABELS.values()
                    or published is None or published > now + timedelta(minutes=5)):
                skipped += 1
                continue
            key = (row['source'], row['external_id'])
            if key in rows:
                skipped += 1
            else:
                rows[key] = row
        return Prepared(label + ' News', 'news', rows=list(rows.values()), skipped=skipped)
    ticker = raw.get('symbol')
    if not isinstance(ticker, str) or ticker not in tickers:
        raise fallback.SafeError('Options JSON must contain a supported symbol (all 19 current tickers are supported).')
    try:
        validate_source_payload(raw, ticker)
        payload = OptionsPayload(normalize(raw, ticker), raw.get('gammaUpdatedAt'))
        payload['fetchedAt'] = now.isoformat()
        json.dumps(payload, allow_nan=False)
        gamma = fallback.timestamp(raw.get('gammaUpdatedAt'))
        if raw.get('gammaUpdatedAt') is not None and (gamma is None or gamma > now + timedelta(minutes=5)):
            raise ValueError('Invalid gamma revision')
    except (ValueError, TypeError, AttributeError, OverflowError):
        raise fallback.SafeError(f'Options {ticker}: invalid values or gamma timestamp; no data imported.') from None
    decision = fallback.options_decision(None, payload, now)
    if decision != 'update':
        raise fallback.SafeError(f'Options {ticker}: {decision}')
    return Prepared(label + f' Options {ticker}', 'options', payload=payload)


def import_options(item, db, revisions, *, dry_run=False):
    ticker = item.payload['symbol']
    # Use the same reads, freshness/gamma decision and atomic CAS as the fallback.
    row = db.options_row(ticker)
    status = fallback.options_status(row, utcnow())
    if status != 'stale':
        return Report(item.label, skipped=1, detail=status)
    row = db.options_row(ticker)
    decision = fallback.options_decision(row, item.payload, utcnow(),
                                        revisions.matching_gamma(row), revisions.cache_changed(row))
    if decision != 'update':
        return Report(item.label, skipped=1, detail=decision)
    action = 'inserted' if row is None else 'updated'
    if dry_run:
        return Report(item.label, **{'would_insert' if row is None else 'would_update': 1})
    item.payload['fetchedAt'] = utcnow().isoformat()
    if not db.save_options(ticker, item.payload, row):
        return Report(item.label, skipped=1, detail='cache changed concurrently; preserved')
    report = Report(item.label, **{action: 1})
    try:
        verified = db.options_row(ticker)
    except fallback.SafeError:
        report.errors = 1
        report.detail = 'write accepted but readback unavailable; no retry made'
        return report
    if not verified or verified.get('payload') != item.payload:
        report.detail = 'write accepted; subsequent cache change preserved'
        return report
    try:
        revisions.remember(verified, item.payload)
        report.detail = 'verified; gamma revision recorded'
    except (OSError, ValueError):
        report.errors = 1
        report.detail = 'write verified; gamma metadata unavailable; future comparisons fail closed'
    return report


def import_news(item, db, *, dry_run=False):
    report = Report(item.label, skipped=item.skipped)
    # These are already supplied articles, not an upstream refresh. Insert-only
    # imports allow group 6 immediately after group 1 even when a source is fresh.
    # Existing IDs are never patched/deleted, regardless of their timestamps.
    for source in fallback.SOURCE_LABELS.values():
        rows = [row for row in item.rows if row['source'] == source]
        if not rows:
            continue
        try:
            existing = db.existing_news_ids(source, [row['external_id'] for row in rows])
            new = [row for row in rows if row['external_id'] not in existing]
            report.skipped += len(rows) - len(new)
            for start in range(0, len(new), 100):
                chunk = new[start:start + 100]
                if dry_run:
                    report.would_insert += len(chunk)
                else:
                    inserted = db.insert_news(chunk)
                    report.inserted += len(inserted)
                    report.skipped += len(chunk) - len(inserted)
        except fallback.SafeError:
            report.errors += 1
            report.detail = 'database request failed; some inserts may have succeeded; duplicates remain protected'
    return report


def archive(text):
    ARCHIVE.mkdir(mode=0o700, parents=True, exist_ok=True)
    if os.name != 'nt':
        ARCHIVE.chmod(0o700)
    path = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=ARCHIVE,
                                         prefix=utcnow().strftime('%Y%m%dT%H%M%SZ-'),
                                         suffix='.json', delete=False) as handle:
            path = Path(handle.name)
            make_private(handle)
            handle.write(text)
    except Exception:
        if path:
            path.unlink(missing_ok=True)
        raise
    return path


@contextmanager
def paste_mode(stream):
    # macOS canonical TTY input truncates long single-line JSON. Turn it off
    # during the interactive session, keeping pasted JSON visible.
    saved = None
    if stream.isatty() and os.name == 'posix':
        import termios
        saved = termios.tcgetattr(stream.fileno())
        mode = termios.tcgetattr(stream.fileno())
        mode[3] = (mode[3] & ~termios.ICANON) | termios.ECHO
        mode[6][termios.VMIN], mode[6][termios.VTIME] = 1, 0
        termios.tcsetattr(stream.fileno(), termios.TCSANOW, mode)
    try:
        yield
    finally:
        if saved is not None:
            termios.tcsetattr(stream.fileno(), termios.TCSANOW, saved)


class JSONBoundary:
    """Find a complete response incrementally; decode() still validates it."""

    def __init__(self):
        self.stack = []
        self.started = self.quoted = self.escaped = False

    def feed(self, text):
        for char in text:
            if self.quoted:
                if char in '\r\n':
                    return True  # Invalid raw newline: report the decoder error.
                if self.escaped:
                    self.escaped = False
                elif char == '\\':
                    self.escaped = True
                elif char == '"':
                    self.quoted = False
            elif not self.started:
                if char.isspace() or char == '\ufeff':
                    continue
                self.started = True
                if char not in '{[':
                    return True  # Response objects/arrays only; validate now.
                self.stack.append('}' if char == '{' else ']')
            elif char == '"':
                self.quoted = True
            elif char in '{[':
                self.stack.append('}' if char == '{' else ']')
            elif char in '}]':
                if not self.stack or char != self.stack.pop() or not self.stack:
                    return True
        return False


def read_input(stream, output):
    if not stream.isatty():
        text = stream.read(MAX_BYTES + 1)
    else:
        parts, length, boundary = [], 0, JSONBoundary()
        with paste_mode(stream):
            output.write('Paste News or Options JSON and press Enter. Input is visible.\n'
                         'Complete responses are processed automatically; multiline JSON is supported.\n'
                         'Paste another response after the result, or type QUIT and press Enter to exit.\n'
                         'Ctrl-C cancels the current operation.\n')
            output.flush()
            while True:
                line = stream.readline(MAX_BYTES + 1)
                if not line:
                    if not parts:
                        return None
                    break
                if line.strip().upper() == 'QUIT':
                    if parts:
                        output.write('Unfinished JSON discarded.\n')
                    return None
                if not parts and not line.strip():
                    continue
                length += len(line.encode('utf-8'))
                if length > MAX_BYTES:
                    raise fallback.SafeError('Input exceeds the 8 MiB limit; no data imported.')
                parts.append(line)
                if boundary.feed(line):
                    break
        text = ''.join(parts)
        output.write('JSON received.\n')
    if len(text.encode('utf-8')) > MAX_BYTES:
        raise fallback.SafeError('Input exceeds the 8 MiB limit; no data imported.')
    return text


def show_validation(items, reports, output):
    print('Detected input:', file=output)
    for report in reports:
        print(f'{report.label}: validation FAILED; excluded. {report.detail}', file=output)
    for item in items:
        if item.kind == 'options':
            detail = f'detected ticker {item.payload["symbol"]}; 1 Options record'
        else:
            sources = ', '.join(f'{source}: {sum(row["source"] == source for row in item.rows)}'
                                for source in fallback.SOURCE_LABELS.values())
            detail = (f'detected Reuters / Financial Juice News feed; '
                      f'{len(item.rows) + item.skipped} articles received, '
                      f'{len(item.rows)} eligible ({sources}), '
                      f'{item.skipped} filtered/duplicate articles')
        print(f'{item.label}: JSON validation PASSED; {detail}.', file=output)
    print('Existing Supabase freshness, duplicate and manual-data protections still apply.', file=output)


def import_once(args, stdin, stdout, *, preview=False):
    reports, items, originals = [], [], []
    try:
        tickers = fallback.allowed_tickers()
        inputs = args.files or [None]
        for number, path in enumerate(inputs, 1):
            label = f'Input {number}'
            try:
                if path is None:
                    text = read_input(stdin, stdout)
                else:
                    with path.open('rb') as handle:
                        data = handle.read(MAX_BYTES + 1)
                    if len(data) > MAX_BYTES:
                        raise fallback.SafeError('Input exceeds the 8 MiB limit; no data imported.')
                    text = data.decode('utf-8-sig')
                documents = decode(text)
                prepared = [prepare(raw, label + (f'.{i}' if len(documents) > 1 else ''), tickers, utcnow())
                            for i, raw in enumerate(documents, 1)]
                items.extend(prepared)
                originals.append(text)
            except fallback.SafeError as error:
                reports.append(Report(label, errors=1, detail=str(error)))
            except (OSError, UnicodeError):
                reports.append(Report(label, errors=1, detail='could not read UTF-8 JSON file'))
        seen_news = set()
        for item in items:
            unique = []
            for row in item.rows:
                key = (row['source'], row['external_id'])
                if key in seen_news:
                    item.skipped += 1
                else:
                    seen_news.add(key)
                    unique.append(row)
            item.rows = unique
        if preview and items:
            show_validation(items, reports, stdout)
        if args.validate_only:
            for item in items:
                count = len(item.rows) if item.kind == 'news' else 1
                reports.append(Report(item.label, skipped=item.skipped, detail=f'valid; {count} eligible records; no database access'))
        elif items:
            # Share the existing lock/provenance file, but never hold it while the
            # user is pasting. This does not alter or stop the scheduled updater.
            with fallback.single_run():
                db = fallback.Database(fallback.load_credentials())
                revisions = OptionsRevisions(fallback.ROOT / '.local-fallback/options-revisions.json')
                if not args.dry_run:
                    for original in originals:
                        archive(original)
                    print('Original JSON saved privately in .local-fallback/manual-imports/ (Git-ignored).', file=stdout)
                # Newest snapshots first within a batch, so older files cannot
                # temporarily fill a missing/stale ticker and block a newer one.
                options = [item for item in items if item.kind == 'options']
                minimum = datetime.min.replace(tzinfo=timezone.utc)
                options.sort(key=lambda item: (fallback.timestamp(item.payload['sourceUpdatedAt']),
                                               fallback.timestamp(item.payload['asOf']),
                                               fallback.timestamp(item.payload.gamma_updated_at) or minimum), reverse=True)
                seen_tickers = set()
                for item in [x for x in items if x.kind == 'news'] + options:
                    if item.kind == 'options':
                        ticker = item.payload['symbol']
                        if ticker in seen_tickers:
                            reports.append(Report(item.label, skipped=1, detail='newer or equal snapshot already selected in this batch'))
                            continue
                        seen_tickers.add(ticker)
                    try:
                        reports.append(import_news(item, db, dry_run=args.dry_run) if item.kind == 'news'
                                       else import_options(item, db, revisions, dry_run=args.dry_run))
                    except fallback.SafeError:
                        reports.append(Report(item.label, errors=1, detail='database request failed; no retry made; write outcome may need readback'))
                    except (ValueError, TypeError, KeyError, OverflowError):
                        reports.append(Report(item.label, errors=1, detail='unexpected cache data; preserved without overwrite'))
    except fallback.SafeError as error:
        reports.append(Report('Import', errors=1, detail=str(error)))
    except (OSError, UnicodeError):
        reports.append(Report('Import', errors=1, detail='local file/permission error; import stopped'))
    except KeyboardInterrupt:
        print('Cancelled. Completed writes, if any, remain; existing rows were not deleted.', file=stdout)
        return 130
    for report in reports:
        print(report.line(), file=stdout)
    fields = ('inserted', 'updated', 'skipped', 'errors', 'would_insert', 'would_update')
    total = Report('TOTAL', **{name: sum(getattr(r, name) for r in reports) for name in fields})
    print(total.line(), file=stdout)
    return 1 if total.errors else 0


def interactive_session(args, stdin, stdout):
    status = 0
    try:
        # Stay noncanonical while importing too: a queued next paste must not
        # be truncated by the terminal's canonical single-line input limit.
        # No database lock is held while waiting for the next response.
        with paste_mode(stdin):
            while True:
                text = read_input(stdin, stdout)
                if text is None:
                    print('Session ended.', file=stdout)
                    return status
                result = import_once(args, io.StringIO(text), stdout, preview=True)
                stdout.flush()
                if result == 130:
                    return result
                status = max(status, result)
    except KeyboardInterrupt:
        print('\nSession ended; unfinished JSON discarded. Completed imports remain.', file=stdout)
        return 130
    except fallback.SafeError as error:
        print(str(error), file=stdout)
        return 1
    except (OSError, UnicodeError):
        print('Terminal input error; session stopped.', file=stdout)
        return 1


def main(argv=None, *, stdin=None, stdout=None):
    stdin, stdout = stdin or sys.stdin, stdout or sys.stdout
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('files', nargs='*', type=Path, help='Local JSON files; omit to paste or pipe JSON')
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--dry-run', action='store_true', help='Compare with Supabase; no writes or archives')
    modes.add_argument('--validate-only', action='store_true', help='Validate locally; no credentials, database access or archives')
    args = parser.parse_args(argv)
    if not args.files and stdin.isatty():
        return interactive_session(args, stdin, stdout)
    return import_once(args, stdin, stdout)


if __name__ == '__main__':
    sys.exit(main())
