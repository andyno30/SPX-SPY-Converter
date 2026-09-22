import contextlib
import io
import json
import unittest
import urllib.error
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

import local_fallback as fallback
import local_fallback_service as service
from sync_direct import normalize, validate_source_payload

NOW = datetime(2026, 9, 21, 20, 0, tzinfo=timezone.utc)


def iso(minutes):
    return (NOW + timedelta(minutes=minutes)).isoformat()


def row():
    return {"ticker": "SPY", "payload": {"symbol": "SPY", "sourceUpdatedAt": iso(-60),
            "asOf": iso(-61), "fetchedAt": iso(-55)}, "source_updated_at": iso(-60),
            "fetched_at": iso(-55), "refresh_started_at": None, "last_attempted_at": iso(-50)}


def incoming():
    return {"symbol": "SPY", "sourceUpdatedAt": iso(-5), "asOf": iso(-6), "fetchedAt": iso(0)}


class OptionsSafetyTests(unittest.TestCase):
    def setUp(self):
        # Keep cache/auth tests independent of the actual local day and time.
        window = patch.object(fallback, "within_options_refresh_window", return_value=True)
        window.start()
        self.addCleanup(window.stop)

    def test_stale_and_strictly_newer_updates(self):
        self.assertEqual(fallback.options_decision(row(), incoming(), NOW), "update")

    def test_fifteen_minute_boundary_preserves_fresh_manual_data(self):
        for field in ("fetched_at", "payload.fetchedAt"):
            for seconds, expected in ((899, "fresh"), (900, "update"), (901, "update")):
                with self.subTest(field=field, seconds=seconds):
                    old = row()
                    stamp = (NOW - timedelta(seconds=seconds)).isoformat()
                    if field == "fetched_at":
                        old["fetched_at"] = stamp
                    else:
                        old["payload"]["fetchedAt"] = stamp
                    self.assertEqual(fallback.options_decision(old, incoming(), NOW), expected)

    def test_equal_or_older_source_never_overwrites(self):
        for age in (-60, -70):
            new = incoming()
            new["sourceUpdatedAt"] = iso(age)
            self.assertNotEqual(fallback.options_decision(row(), new, NOW), "update")

    def test_recent_manual_payload_fetch_time_wins_over_old_table(self):
        old = row()
        old["payload"]["fetchedAt"] = iso(-2)
        self.assertEqual(fallback.options_decision(old, incoming(), NOW), "fresh")

    def test_stale_manual_newer_payload_source_wins_over_old_table(self):
        old = row()
        old["payload"]["sourceUpdatedAt"] = iso(-25)
        new = incoming()
        new["sourceUpdatedAt"] = iso(-30)
        self.assertIn("older or equal", fallback.options_decision(old, new, NOW))

    def test_newer_table_source_also_wins(self):
        old = row()
        old["source_updated_at"] = iso(-25)
        new = incoming()
        new["sourceUpdatedAt"] = iso(-30)
        self.assertIn("older or equal", fallback.options_decision(old, new, NOW))

    def test_asof_cannot_regress_even_when_snapshot_timestamp_advances(self):
        new = incoming()
        new["asOf"] = iso(-90)
        self.assertIn("asOf", fallback.options_decision(row(), new, NOW))

    def test_unknown_existing_timestamps_are_preserved(self):
        old = row()
        old["payload"]["fetchedAt"] = "invalid"
        self.assertIn("unknown", fallback.options_decision(old, incoming(), NOW))
        old = row()
        old["payload"].pop("sourceUpdatedAt")
        old["source_updated_at"] = None
        self.assertIn("unknown", fallback.options_decision(old, incoming(), NOW))

    def test_missing_or_future_incoming_timestamp_is_rejected(self):
        for value in (None, "invalid", iso(30)):
            new = incoming()
            new["sourceUpdatedAt"] = value
            self.assertNotEqual(fallback.options_decision(row(), new, NOW), "update")

    def test_active_live_refresh_is_left_alone(self):
        old = row()
        old["refresh_started_at"] = iso(-1)
        self.assertIn("in progress", fallback.options_decision(old, incoming(), NOW))

    def test_conditional_write_covers_payload_only_manual_edits_and_gate_columns(self):
        db = fallback.Database({"PROJECT_URL": "https://example.test", "SERVICE_ROLE_KEY": "test"})
        old = row()
        with patch.object(db, "request", return_value=[]) as request:
            self.assertEqual(db.save_options("SPY", incoming(), old), [])
        query = request.call_args.args[1]
        self.assertEqual(json.loads(query["payload"][3:]), old["payload"])
        for field in ("source_updated_at", "fetched_at", "last_attempted_at", "refresh_started_at"):
            self.assertIn(field, query)
        body = request.call_args.kwargs["body"]
        self.assertNotIn("last_attempted_at", body)
        self.assertNotIn("refresh_started_at", body)
        self.assertEqual(request.call_args.kwargs["method"], "PATCH")

    def test_absent_row_insert_never_overwrites_concurrent_manual_insert(self):
        db = fallback.Database({"PROJECT_URL": "https://example.test", "SERVICE_ROLE_KEY": "test"})
        with patch.object(db, "request", return_value=[]) as request:
            db.save_options("SPY", incoming(), None)
        self.assertIn("ignore-duplicates", request.call_args.kwargs["prefer"])

    def test_fresh_row_skips_upstream(self):
        old = row()
        old["payload"]["fetchedAt"] = datetime.now(timezone.utc).isoformat()
        db = Mock()
        db.options_row.return_value = old
        with patch.object(fallback, "allowed_tickers", return_value=["SPY"]), \
                patch.object(fallback, "fetch_options") as fetch, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(fallback.run_options(db, "fixture"), 0)
        fetch.assert_not_called()
        db.save_options.assert_not_called()

    def test_manual_refresh_during_fetch_prevents_write(self):
        db = Mock()
        fresh = row()
        fresh["payload"]["fetchedAt"] = datetime.now(timezone.utc).isoformat()
        db.options_row.side_effect = [row(), fresh]
        with patch.object(fallback, "allowed_tickers", return_value=["SPY"]), \
                patch.object(fallback, "fetch_options", return_value=incoming()), contextlib.redirect_stdout(io.StringIO()):
            fallback.run_options(db, "fixture")
        db.save_options.assert_not_called()

    def test_dry_run_fetches_and_compares_without_writes(self):
        db = Mock()
        db.options_row.return_value = row()
        with patch.object(fallback, "allowed_tickers", return_value=["SPY"]), \
                patch.object(fallback, "fetch_options", return_value=incoming()), contextlib.redirect_stdout(io.StringIO()):
            fallback.run_options(db, "fixture", dry_run=True)
        self.assertEqual(db.options_row.call_count, 2)
        db.save_options.assert_not_called()

    def test_spy_failure_stops_remaining_options_requests(self):
        db = Mock()
        db.options_row.return_value = row()
        with patch.object(fallback, "allowed_tickers", return_value=["SPY", "QQQ"]), \
                patch.object(fallback, "fetch_options", side_effect=fallback.SafeError("HTTP 401")) as fetch, \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(fallback.run_options(db, "fixture"), 1)
        self.assertEqual(fetch.call_count, 1)

    def test_overall_timeout_is_not_swallowed(self):
        db = Mock()
        db.options_row.return_value = row()
        with patch.object(fallback, "allowed_tickers", return_value=["SPY"]), \
                patch.object(fallback, "fetch_options", side_effect=fallback.RunTimeout("timeout")):
            with self.assertRaises(fallback.RunTimeout):
                fallback.run_options(db, "fixture")

    def test_application_cookie_is_the_only_cookie(self):
        with patch.object(fallback, "request_json", return_value={}) as request:
            with self.assertRaises(fallback.SafeError):
                fallback.fetch_options("SPY", "synthetic-token")
        headers = request.call_args.args[1]
        self.assertEqual(headers["Cookie"], "access_token=synthetic-token")
        self.assertNotIn("Authorization", headers)

    def test_current_allowlist_and_requested_order(self):
        tickers = fallback.allowed_tickers()
        self.assertEqual(tickers[:3], ["SPY", "QQQ", "SNDK"])
        self.assertEqual(len(tickers), 19)

    def test_existing_python_normalization_default_is_preserved(self):
        data = {"referencePrice": 100, "nearestExpiry": "2026-09-25", "maxPain": 101,
                "putCallRatioVolume": 1.2, "putCallRatioOpenInterest": 1.3, "volume": 1200,
                "callWall": 110, "putWall": 90, "gammaFlip": 102, "gammaPer1Pct": 123456,
                "netGammaExposure": 999999, "volumeShare": {"call": 40, "put": 60},
                "openInterestShare": {}, "premiumShare": {}, "vsAvg3d": 1.25}
        validate_source_payload(data)
        old = normalize(data)
        new = normalize(data, "QQQ")
        self.assertEqual(old["symbol"], "SPY")
        self.assertEqual(new.pop("symbol"), "QQQ")
        old.pop("symbol")
        self.assertEqual(old, new)
        self.assertEqual(new["netGex"], data["gammaPer1Pct"])
        self.assertEqual(new["relativeVolume"]["3d"], 125.0)

    def test_launchd_schedule_has_no_secrets_or_endless_restart(self):
        config = service.configuration()
        self.assertEqual(config["StartInterval"], 900)
        self.assertTrue(config["RunAtLoad"])
        self.assertNotIn("KeepAlive", config)
        self.assertNotIn("EnvironmentVariables", config)
        self.assertEqual(config["ProgramArguments"][-1], "--scheduled")

    def test_error_diagnostics_never_echo_arbitrary_response_headers(self):
        error = urllib.error.HTTPError("https://example.test", 403, "forbidden", {
            "Content-Type": "synthetic-secret", "cf-ray": "synthetic-secret",
        }, None)
        with patch.object(fallback.urllib.request.OpenerDirector, "open", side_effect=error):
            with self.assertRaises(fallback.SafeError) as caught:
                fallback.request_json("https://example.test", {}, "Options SPY")
        self.assertIn("HTTP 403", str(caught.exception))
        self.assertNotIn("synthetic-secret", str(caught.exception))


class OptionsWindowTests(unittest.TestCase):
    def test_pacific_weekday_boundaries_in_summer_and_winter(self):
        for day, offset in (("2026-09-21", "-07:00"), ("2026-01-05", "-08:00")):
            for clock, expected in (("05:29:59", False), ("05:30:00", True),
                                    ("13:59:59", True), ("14:00:00", False)):
                with self.subTest(day=day, clock=clock):
                    instant = datetime.fromisoformat(f"{day}T{clock}{offset}").astimezone(timezone.utc)
                    self.assertEqual(fallback.within_options_refresh_window(instant), expected)

    def test_weekends_use_pacific_date(self):
        for instant in ("2026-09-19T12:30:00Z", "2026-09-20T20:59:59Z",
                        "2026-09-21T01:00:00Z"):
            self.assertFalse(fallback.within_options_refresh_window(datetime.fromisoformat(instant)))

    def test_outside_window_never_reads_or_fetches_options(self):
        db = Mock()
        with patch.object(fallback, "within_options_refresh_window", return_value=False), \
                patch.object(fallback, "fetch_options") as fetch, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(fallback.run_options(db, "fixture"), 0)
        db.options_row.assert_not_called()
        db.save_options.assert_not_called()
        fetch.assert_not_called()

    def test_crossing_end_of_window_stops_remaining_fetches(self):
        db = Mock()
        db.options_row.return_value = row()
        with patch.object(fallback, "within_options_refresh_window", side_effect=[True, True, False]), \
                patch.object(fallback, "allowed_tickers", return_value=["SPY", "QQQ"]), \
                patch.object(fallback, "fetch_options", return_value=incoming()) as fetch, \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(fallback.run_options(db, "fixture", dry_run=True), 0)
        fetch.assert_called_once_with("SPY", "fixture")
        db.save_options.assert_not_called()


if __name__ == "__main__":
    unittest.main()
