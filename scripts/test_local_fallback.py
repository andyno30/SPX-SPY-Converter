import contextlib
import errno
import io
import os
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, call, patch

import local_fallback as fallback


def article(source="reuters", article_id="new-1"):
    return {
        "id": article_id, "source": source, "title": "Markets rise",
        "created_at": "2026-09-21T19:00:00Z", "tickers": ["SPY"],
    }


class FakeDB:
    def __init__(self, fresh=(), existing=()):
        self.fresh = set(fresh)
        self.existing = set(existing)
        self.writes = []

    def news_fresh(self, source, now):
        return source in self.fresh

    def existing_news_ids(self, source, ids):
        return {identifier for identifier in ids if (source, identifier) in self.existing}

    def insert_news(self, rows):
        self.writes.extend(rows)
        return [{"id": i} for i, _ in enumerate(rows)]


class NewsSafetyTests(unittest.TestCase):
    def setUp(self):
        self.quiet = contextlib.redirect_stdout(io.StringIO())
        self.quiet.__enter__()

    def tearDown(self):
        self.quiet.__exit__(None, None, None)

    def test_fresh_sources_never_contact_upstream(self):
        db = FakeDB(fresh=("Reuters", "Financial Juice"))
        with patch.object(fallback, "request_json") as request:
            fallback.run_news(db)
        request.assert_not_called()
        self.assertEqual(db.writes, [])

    def test_dry_run_never_writes_and_reuses_both_feeds(self):
        db = FakeDB()
        with patch.object(fallback, "request_json", return_value={"news_list": [article()]}) as request:
            fallback.run_news(db, dry_run=True)
        self.assertEqual(request.call_count, 2)
        self.assertEqual(db.writes, [])

    def test_existing_manual_rows_and_cnbc_are_untouched(self):
        db = FakeDB(existing=(("Reuters", "manual"),))
        payload = {"news_list": [article(article_id="manual"), article(),
                                  article("financial-juice"), article("cnbc")]}
        with patch.object(fallback, "request_json", return_value=payload):
            fallback.run_news(db)
        self.assertEqual([(x["source"], x["external_id"]) for x in db.writes],
                         [("Reuters", "new-1"), ("Financial Juice", "new-1")])
        self.assertEqual(db.writes[0]["source_type"], "wire")
        self.assertEqual(db.writes[1]["source_type"], "terminal")
        self.assertIsNone(db.writes[0]["original_url"])

    def test_only_stale_source_written_when_feeds_mix_sources(self):
        db = FakeDB(fresh=("Reuters",))
        payload = {"news_list": [article(), article("financial-juice")]}
        with patch.object(fallback, "request_json", return_value=payload):
            fallback.run_news(db)
        self.assertEqual([x["source"] for x in db.writes], ["Financial Juice"])

    def test_manual_or_automation_refresh_during_fetch_wins(self):
        db = FakeDB()
        def fetch(*args):
            db.fresh.update(("Reuters", "Financial Juice"))
            return {"news_list": [article(), article("financial-juice")]}
        with patch.object(fallback, "request_json", side_effect=fetch):
            fallback.run_news(db)
        self.assertEqual(db.writes, [])

    def test_invalid_second_feed_prevents_all_writes(self):
        db = FakeDB()
        with patch.object(fallback, "request_json", side_effect=[{"news_list": [article()]}, {}]):
            with self.assertRaises(fallback.SafeError):
                fallback.run_news(db)
        self.assertEqual(db.writes, [])

    def test_insert_uses_ignore_duplicates_never_merge(self):
        db = fallback.Database({"PROJECT_URL": "https://example.test", "SERVICE_ROLE_KEY": "test"})
        with patch.object(db, "request", return_value=[]) as request:
            db.insert_news([{}])
        self.assertEqual(request.call_args.kwargs["method"], "POST")
        self.assertEqual(request.call_args.args[1]["on_conflict"], "source,external_id")
        self.assertIn("resolution=ignore-duplicates", request.call_args.kwargs["prefer"])

    def test_source_specific_freshness_queries_cannot_include_cnbc(self):
        db = fallback.Database({"PROJECT_URL": "https://example.test", "SERVICE_ROLE_KEY": "test"})
        with patch.object(db, "request", return_value=[]) as request:
            self.assertFalse(db.news_fresh("Reuters", datetime.now(timezone.utc)))
        for call in request.call_args_list:
            self.assertEqual(call.args[1]["source"], "eq.Reuters")

    def test_fifteen_minute_boundary_and_invalid_dates(self):
        now = datetime.now(timezone.utc)
        self.assertFalse(fallback.is_recent((now - timedelta(minutes=15)).isoformat(), now))
        self.assertFalse(fallback.is_recent((now - timedelta(minutes=15, seconds=1)).isoformat(), now))
        self.assertTrue(fallback.is_recent((now - timedelta(minutes=14, seconds=59)).isoformat(), now))
        self.assertFalse(fallback.is_recent("invalid", now))

    def test_news_headers_are_cookie_and_auth_free(self):
        self.assertEqual(set(fallback.NEWS_HEADERS), {"Accept", "User-Agent"})

    def test_root_env_only_and_never_executes_shell_expansion(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env.local").write_text("PROJECT_URL=https://example.test\nSERVICE_ROLE_KEY='$(do-not-run)'\n")
            with patch.object(fallback, "ROOT", root):
                config = fallback.load_credentials()
            self.assertEqual(config["SERVICE_ROLE_KEY"], "$(do-not-run)")

    def test_overlapping_runs_are_rejected_and_lock_released(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(fallback, "ROOT", Path(directory)):
            with fallback.single_run():
                with self.assertRaises(fallback.SafeError):
                    with fallback.single_run():
                        self.fail("overlapping run entered")
            with fallback.single_run():
                pass


class LockingTests(unittest.TestCase):
    def test_cli_imports_and_displays_help(self):
        result = subprocess.run(
            [sys.executable, "-B", str(Path(fallback.__file__)), "--help"],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--dry-run", result.stdout)

    def test_separate_process_is_rejected_until_lock_released(self):
        code = """
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import local_fallback as fallback
fallback.ROOT = Path(sys.argv[2])
try:
    with fallback.single_run():
        print("acquired")
except fallback.SafeError as error:
    print(error)
    sys.exit(1)
"""
        for contents in ("", "previous run\n"):
            with self.subTest(contents=contents), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                state = root / ".local-fallback"
                state.mkdir()
                lock = state / "run.lock"
                lock.write_text(contents)
                command = [sys.executable, "-B", "-c", code,
                           str(Path(fallback.__file__).parent), directory]
                with patch.object(fallback, "ROOT", root):
                    with fallback.single_run():
                        blocked = subprocess.run(command, capture_output=True, text=True, timeout=10)
                        self.assertEqual(blocked.returncode, 1, blocked.stderr)
                        self.assertIn("another local fallback run is active", blocked.stdout)
                    released = subprocess.run(command, capture_output=True, text=True, timeout=10)
                self.assertEqual(released.returncode, 0, released.stderr)
                self.assertEqual(released.stdout.strip(), "acquired")
                self.assertEqual(lock.read_text(), contents)

    def test_body_exception_releases_lock(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(fallback, "ROOT", Path(directory)):
            with self.assertRaisesRegex(RuntimeError, "body failed"):
                with fallback.single_run():
                    raise RuntimeError("body failed")
            with fallback.single_run():
                pass

    def test_posix_flock_flags_and_errors_are_unchanged(self):
        for platform in ("darwin", "linux"):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as directory:
                backend = SimpleNamespace(flock=Mock(), LOCK_EX=2, LOCK_NB=4)
                with patch.object(fallback, "ROOT", Path(directory)), \
                        patch.object(fallback, "sys", SimpleNamespace(platform=platform)), \
                        patch.object(fallback, "fcntl", backend, create=True):
                    with fallback.single_run():
                        handle, flags = backend.flock.call_args.args
                        self.assertFalse(handle.closed)
                        self.assertEqual(flags, backend.LOCK_EX | backend.LOCK_NB)
                    backend.flock.assert_called_once()
                    self.assertTrue(handle.closed)
                    backend.flock.side_effect = BlockingIOError(errno.EAGAIN, "busy")
                    with self.assertRaisesRegex(fallback.SafeError, "another local fallback run is active"):
                        with fallback.single_run():
                            self.fail("overlapping run entered")
                    backend.flock.side_effect = OSError(errno.EIO, "lock failed")
                    with self.assertRaises(OSError):
                        with fallback.single_run():
                            self.fail("run entered after lock failure")

    def test_windows_only_contention_is_reported_as_overlap(self):
        for error_number in (errno.EACCES, errno.EBADF, errno.EINVAL):
            with self.subTest(errno=error_number), tempfile.TemporaryDirectory() as directory:
                backend = SimpleNamespace(
                    locking=Mock(side_effect=OSError(error_number, "lock failed")),
                    LK_NBLCK=2, LK_UNLCK=0,
                )
                with patch.object(fallback, "ROOT", Path(directory)), \
                        patch.object(fallback, "sys", SimpleNamespace(platform="win32")), \
                        patch.object(fallback, "msvcrt", backend, create=True):
                    expected = fallback.SafeError if error_number == errno.EACCES else OSError
                    with self.assertRaises(expected):
                        with fallback.single_run():
                            self.fail("run entered after lock failure")
                # Failed acquisition must not attempt to unlock another run's lock.
                backend.locking.assert_called_once()
                self.assertEqual(backend.locking.call_args.args[1:], (backend.LK_NBLCK, 1))


class TimeoutTests(unittest.TestCase):
    def windows_process(self, directory, body):
        code = """
import sys
import time
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import local_fallback as fallback
fallback.ROOT = Path(sys.argv[2])
fallback.RUN_TIMEOUT = 0.25
sys.argv = ["local_fallback.py", "--dry-run"]
fallback.load_credentials = lambda: {"PROJECT_URL": "https://example.test", "SERVICE_ROLE_KEY": "fixture"}
fallback.Database = lambda credentials: object()
fallback.run_news = lambda db, *, dry_run: None
fallback.run_options = lambda db, token, *, dry_run: 0
"""
        return subprocess.run(
            [sys.executable, "-B", "-c", code + body,
             str(Path(fallback.__file__).parent), directory],
            capture_output=True, text=True, timeout=10,
        )

    @unittest.skipUnless(sys.platform == "win32", "native Windows watchdog")
    def test_windows_dry_run_executes_and_cancels_watchdog(self):
        with tempfile.TemporaryDirectory() as directory:
            result = self.windows_process(directory, """
def news(db, *, dry_run):
    assert dry_run
    print("News dry-run", flush=True)
def options(db, token, *, dry_run):
    assert dry_run
    print("Options dry-run", flush=True)
    return 0
fallback.run_news = news
fallback.run_options = options
assert fallback.main() == 0
time.sleep(0.5)
print("watchdog canceled", flush=True)
""")
        self.assertEqual(result.returncode, 0, result.stderr)
        for message in ("News dry-run", "Options dry-run", "Run complete: mode=dry-run", "watchdog canceled"):
            self.assertIn(message, result.stdout)

    @unittest.skipUnless(sys.platform == "win32", "native Windows watchdog")
    def test_windows_timeout_stops_blocked_work_and_releases_lock(self):
        for stage in ("load_credentials", "run_news", "run_options", "log"):
            with self.subTest(stage=stage), tempfile.TemporaryDirectory() as directory:
                body = """
def blocked(*args, **kwargs):
    print("entered blocked work", flush=True)
    time.sleep(30)
    print("continued after deadline", flush=True)
""" + f"fallback.{stage} = blocked\nfallback.main()\nprint('main returned', flush=True)\n"
                started = time.monotonic()
                result = self.windows_process(directory, body)
                self.assertLess(time.monotonic() - started, 5)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertIn("entered blocked work", result.stdout)
                self.assertNotIn("continued after deadline", result.stdout)
                self.assertNotIn("main returned", result.stdout)
                self.assertEqual(result.stderr, "")
                with patch.object(fallback, "ROOT", Path(directory)):
                    with fallback.single_run():
                        pass

    @unittest.skipUnless(sys.platform == "win32", "native Windows watchdog")
    def test_windows_error_cancels_watchdog_without_leaking_details(self):
        with tempfile.TemporaryDirectory() as directory:
            result = self.windows_process(directory, """
def fail():
    raise RuntimeError("synthetic-secret")
fallback.load_credentials = fail
assert fallback.main() == 1
time.sleep(0.5)
print("watchdog canceled", flush=True)
""")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Unexpected local updater failure", result.stdout)
        self.assertIn("watchdog canceled", result.stdout)
        self.assertNotIn("synthetic-secret", result.stdout + result.stderr)

    @unittest.skipUnless(sys.platform == "win32", "native Windows watchdog")
    def test_windows_overlap_exits_before_starting_watchdog(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(fallback, "ROOT", Path(directory)), \
                patch.object(sys, "argv", ["local_fallback.py", "--dry-run"]), \
                patch.object(fallback.threading, "Timer") as timer, \
                patch.object(fallback, "load_credentials") as credentials, \
                contextlib.redirect_stdout(io.StringIO()):
            with fallback.single_run():
                self.assertEqual(fallback.main(), 1)
            timer.assert_not_called()
            credentials.assert_not_called()

    @unittest.skipUnless(sys.platform == "win32", "native Windows watchdog")
    def test_windows_watchdog_start_failure_prevents_work_and_stays_sanitized(self):
        timer = Mock(ident=None)
        timer.start.side_effect = RuntimeError("synthetic-secret")
        with tempfile.TemporaryDirectory() as directory, patch.object(fallback, "ROOT", Path(directory)), \
                patch.object(sys, "argv", ["local_fallback.py", "--dry-run"]), \
                patch.object(fallback.threading, "Timer", return_value=timer), \
                patch.object(fallback, "load_credentials") as credentials, \
                contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(fallback.main(), 1)
            with fallback.single_run():
                pass
        credentials.assert_not_called()
        timer.cancel.assert_called_once()
        timer.join.assert_not_called()
        self.assertNotIn("synthetic-secret", output.getvalue())

    def test_posix_alarm_setup_cancellation_and_timeout_propagation_unchanged(self):
        for platform in ("darwin", "linux"):
            for timed_out in (False, True):
                with self.subTest(platform=platform, timed_out=timed_out):
                    signals = Mock(SIGALRM=14)
                    with patch.object(fallback, "sys", SimpleNamespace(platform=platform)), \
                            patch.object(sys, "argv", ["local_fallback.py", "--dry-run"]), \
                            patch.object(fallback, "signal", signals), \
                            patch.object(fallback, "single_run", contextlib.nullcontext), \
                            patch.object(fallback, "load_credentials", return_value={}), \
                            patch.object(fallback, "Database"), \
                            patch.object(fallback, "run_news") as news, \
                            patch.object(fallback, "run_options", return_value=0) as options, \
                            contextlib.redirect_stdout(io.StringIO()) as output:
                        if timed_out:
                            news.side_effect = fallback.RunTimeout("Run timeout reached; stopped.")
                        self.assertEqual(fallback.main(), int(timed_out))
                    self.assertEqual(signals.mock_calls, [
                        call.signal(signals.SIGALRM, fallback.timeout_handler),
                        call.alarm(fallback.RUN_TIMEOUT), call.alarm(0),
                    ])
                    if timed_out:
                        options.assert_not_called()
                        self.assertIn("Run timeout reached; stopped.", output.getvalue())


@unittest.skipUnless(sys.platform == "win32", "Windows text encoding")
class WindowsEncodingTests(unittest.TestCase):
    def test_outside_window_console_and_scheduled_logs_are_utf8(self):
        code = """
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, sys.argv[1])
import local_fallback as fallback
fallback.ROOT = Path(sys.argv[2])
scheduled = sys.argv[3] == "scheduled"
sys.argv = ["local_fallback.py", "--dry-run", "--options-only"]
if scheduled:
    sys.argv.append("--scheduled")
fallback.load_credentials = lambda: {}
fallback.Database = lambda credentials: object()
class Sunday:
    @staticmethod
    def now(tz):
        return datetime(2026, 9, 20, 20, tzinfo=timezone.utc)
with patch.object(fallback, "datetime", Sunday):
    sys.exit(fallback.main())
"""
        for mode in ("console", "scheduled"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                environment = dict(os.environ, PYTHONIOENCODING="cp949")
                result = subprocess.run(
                    [sys.executable, "-B", "-c", code, str(Path(fallback.__file__).parent), directory, mode],
                    capture_output=True, encoding="utf-8", env=environment, timeout=10,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stderr, "")
                output = result.stdout if mode == "console" else (
                    Path(directory) / ".local-fallback/fallback.log").read_text(encoding="utf-8")
                self.assertIn("05:30–14:00 Pacific", output)
                self.assertIn("failures=0", output)


if __name__ == "__main__":
    unittest.main()
