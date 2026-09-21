import contextlib
import io
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

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

    def test_twenty_minute_boundary_and_invalid_dates(self):
        now = datetime.now(timezone.utc)
        self.assertFalse(fallback.is_recent((now - timedelta(minutes=20)).isoformat(), now))
        self.assertTrue(fallback.is_recent((now - timedelta(minutes=19)).isoformat(), now))
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


if __name__ == "__main__":
    unittest.main()
