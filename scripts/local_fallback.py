#!/usr/bin/env python3
"""Local Reuters/FJ + Options fallback. Uses only the repo-root .env.local."""

from __future__ import annotations

import argparse
import fcntl
import json
import logging
from logging.handlers import RotatingFileHandler
import re
import shlex
import signal
import sys
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from sync_news import LIST_ENDPOINTS, SOURCE_LABELS, normalize_item, normalize_timestamp
from sync_direct import normalize as normalize_options, validate_source_payload
from options_revisions import OptionsPayload, OptionsRevisions

ROOT = Path(__file__).resolve().parents[1]
STALE_AFTER = timedelta(minutes=15)
HTTP_TIMEOUT = 20
RUN_TIMEOUT = 600
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
NEWS_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "SpyConverterNewsBot/1.0 (+https://spyconverter.com)",
}
LOGGER = None


class SafeError(Exception):
    """Only constant/allowlisted operational diagnostics may enter this message."""


class RunTimeout(SafeError):
    pass


def log(message: str) -> None:
    line = f"{datetime.now(timezone.utc).isoformat()} {message}"
    if LOGGER is not None:
        LOGGER.info(line)
    else:
        print(line, flush=True)


def load_credentials() -> dict[str, str]:
    # Deliberately never read news-app/.env.local or inherit frontend values.
    path = ROOT / ".env.local"
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        raise SafeError("Configure PROJECT_URL and SERVICE_ROLE_KEY in root .env.local.") from None
    values = {}
    try:
        for line in lines:
            tokens = shlex.split(line, comments=True)
            if not tokens:
                continue
            if tokens[0] == "export":
                tokens = tokens[1:]
            key, separator, value = " ".join(tokens).partition("=")
            if separator and key.strip() in ("PROJECT_URL", "SERVICE_ROLE_KEY", "UPSTREAM_ACCESS_TOKEN"):
                values[key.strip()] = value.strip()
    except ValueError:
        raise SafeError("Invalid quoting in root .env.local.") from None
    if not all(values.get(key) for key in ("PROJECT_URL", "SERVICE_ROLE_KEY")):
        raise SafeError("Configure PROJECT_URL and SERVICE_ROLE_KEY in root .env.local.")
    url = urllib.parse.urlsplit(values["PROJECT_URL"])
    if (url.scheme != "https" or not url.hostname or url.username or url.password
            or url.query or url.fragment or url.path not in ("", "/")):
        raise SafeError("PROJECT_URL must be an HTTPS project origin.")
    return values


class NoRedirect(urllib.request.HTTPRedirectHandler):
    # Never forward credentials to a redirect destination.
    def redirect_request(self, *args, **kwargs):
        return None


def request_json(url, headers, label, *, method="GET", body=None):
    data = None if body is None else json.dumps(body, allow_nan=False).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=HTTP_TIMEOUT) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise SafeError(f"{label}: response exceeded size limit.")
            payload = json.loads(raw)
            log(f"{label}: HTTP {response.status}, valid JSON")
            return payload
    except urllib.error.HTTPError as error:
        raw_type = error.headers.get("Content-Type", "").split(";", 1)[0].lower().strip()
        content_type = raw_type if raw_type in (
            "application/json", "text/html", "text/plain", "application/problem+json"
        ) else "unknown"
        raw_ray = error.headers.get("cf-ray", "")
        ray = raw_ray if re.fullmatch(r"[a-fA-F0-9]{16,32}(?:-[A-Z]{3})?", raw_ray) else "absent/redacted"
        raise SafeError(
            f"{label}: HTTP {error.code}, content-type={content_type}, cf-ray={ray}"
        ) from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise SafeError(f"{label}: invalid JSON; no response body logged.") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise SafeError(f"{label}: network/TLS/timeout failure.") from None


class Database:
    def __init__(self, credentials):
        self.base = credentials["PROJECT_URL"].rstrip("/") + "/rest/v1/"
        self.headers = {
            "apikey": credentials["SERVICE_ROLE_KEY"],
            "Authorization": "Bearer " + credentials["SERVICE_ROLE_KEY"],
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def request(self, table, query, *, method="GET", body=None, prefer=None):
        headers = dict(self.headers)
        if prefer:
            headers["Prefer"] = prefer
        result = request_json(
            self.base + table + "?" + urllib.parse.urlencode(query), headers,
            f"database {table} {method}", method=method, body=body,
        )
        if not isinstance(result, list) or any(not isinstance(row, dict) for row in result):
            raise SafeError(f"Unexpected {table} result schema.")
        return result

    def news_fresh(self, source, now):
        # CNBC and other sources cannot satisfy this filter. fetched_at is the
        # insertion time; published_at also protects newly imported manual news.
        for field in ("fetched_at", "published_at"):
            rows = self.request("news_articles", {
                "select": field, "source": "eq." + source,
                "order": field + ".desc", "limit": "1",
            })
            if rows and is_recent(rows[0].get(field), now):
                return True
        return False

    def existing_news_ids(self, source, ids):
        # JSON quoting protects punctuation in upstream IDs within PostgREST in().
        found = set()
        for start in range(0, len(ids), 50):
            values = ",".join(json.dumps(value) for value in ids[start:start + 50])
            rows = self.request("news_articles", {
                "select": "external_id", "source": "eq." + source,
                "external_id": "in.(" + values + ")",
            })
            found.update(row["external_id"] for row in rows)
        return found

    def insert_news(self, rows):
        # DO NOTHING on the existing unique key, including concurrent inserts.
        # Never PATCH, DELETE, or merge an existing News row.
        return self.request("news_articles", {
            "on_conflict": "source,external_id", "select": "id",
        }, method="POST", body=rows,
            prefer="resolution=ignore-duplicates,return=representation")

    def options_row(self, ticker):
        rows = self.request("options_cache", {
            "select": "ticker,payload,source_updated_at,fetched_at,last_attempted_at,refresh_started_at",
            "ticker": "eq." + ticker,
        })
        if len(rows) > 1:
            raise SafeError(f"Options {ticker}: unexpected duplicate cache rows.")
        return rows[0] if rows else None

    def save_options(self, ticker, payload, previous):
        body = {"payload": payload, "source_updated_at": payload["sourceUpdatedAt"],
                "fetched_at": payload["fetchedAt"]}
        if previous is None:
            return self.request("options_cache", {"on_conflict": "ticker", "select": "ticker"},
                                method="POST", body={"ticker": ticker, **body},
                                prefer="resolution=ignore-duplicates,return=representation")
        # Atomic compare-and-swap includes the entire JSONB payload. A manual
        # payload-only edit after our final read makes this PATCH affect zero rows.
        # Include every other mutable cache column to defer to concurrent live
        # refreshes, without changing/claiming their existing refresh gate.
        query = {"ticker": "eq." + ticker, "select": "ticker",
                 "payload": "eq." + json.dumps(previous["payload"], separators=(",", ":"), allow_nan=False)}
        for field in ("source_updated_at", "fetched_at", "last_attempted_at", "refresh_started_at"):
            value = previous.get(field)
            query[field] = "is.null" if value is None else "eq." + value
        return self.request("options_cache", query, method="PATCH", body=body,
                            prefer="return=representation")


def allowed_tickers():
    source = (ROOT / "supabase/functions/fetch-spy-options/index.ts").read_text()
    match = re.search(r"const ALLOWED_TICKERS\s*=\s*new Set\(\[(.*?)\]\)", source, re.S)
    if not match:
        raise SafeError("Could not read the production Options allowlist.")
    tickers = re.findall(r'"([A-Z]{1,5})"', match.group(1))
    if not tickers or len(set(tickers)) != len(tickers):
        raise SafeError("Invalid production Options allowlist.")
    first = [t for t in ("SPY", "QQQ", "SNDK") if t in tickers]
    return first + [t for t in tickers if t not in first]


def timestamp(value):
    normalized = normalize_timestamp(value)
    return datetime.fromisoformat(normalized.replace("Z", "+00:00")) if normalized else None


def options_status(row, now):
    if row is None:
        return "stale"
    payload = row.get("payload")
    if not isinstance(payload, dict):
        return "unknown existing payload; preserved"
    # A payload-only Table Editor edit need not advance the table timestamps.
    values = [row.get("fetched_at"), row.get("source_updated_at"),
              payload.get("fetchedAt"), payload.get("sourceUpdatedAt"), payload.get("asOf"),
              payload.get("snapshotUpdatedAt"), payload.get("batchUpdatedAt")]
    parsed = [timestamp(value) for value in values if value is not None]
    if any(value is None for value in parsed):
        return "unknown existing timestamp; preserved"
    if any(value > now - STALE_AFTER for value in parsed):
        return "fresh"
    started = row.get("refresh_started_at")
    if started is not None:
        parsed_started = timestamp(started)
        if parsed_started is None or parsed_started > now - timedelta(minutes=2):
            return "Supabase refresh in progress"
    return "stale"


GAMMA_FIELDS = frozenset(("currentPrice", "gammaFlip", "netGex", "netGexFormatted",
                          "rawNetGammaExposure", "callWall", "putWall"))


def options_decision(row, incoming, now, known_gamma=None, gamma_cache_changed=False):
    status = options_status(row, now)
    if status != "stale":
        return status
    new_source = timestamp(incoming.get("sourceUpdatedAt"))
    new_asof = timestamp(incoming.get("asOf"))
    if new_source is None or new_asof is None:
        return "missing incoming source timestamp; preserved"
    if max(new_source, new_asof) > now + timedelta(minutes=5):
        return "incoming timestamp is in the future; preserved"
    if row and row.get("payload"):
        old = row["payload"]
        if old.get("symbol") != incoming.get("symbol"):
            return "existing symbol mismatch; preserved"
        old_sources = [timestamp(value) for value in (
            row.get("source_updated_at"), old.get("sourceUpdatedAt"),
            old.get("snapshotUpdatedAt"), old.get("batchUpdatedAt")) if value is not None]
        if not old_sources or any(value is None for value in old_sources):
            return "unknown existing source timestamp; preserved"
        if new_source < max(old_sources):
            return "incoming source is older or equal; preserved"
        old_asof = timestamp(old.get("asOf"))
        if old_asof is None or new_asof < old_asof or new_source < old_asof:
            return "incoming asOf would regress or cannot be compared; preserved"
        # Retrieval time and polling hints are not market-data revisions.
        changed = {key for key in set(old) | set(incoming)
                   if key not in ("fetchedAt", "nextPollAfterMs") and old.get(key) != incoming.get(key)}
        new_gamma = timestamp(getattr(incoming, "gamma_updated_at", None))
        previous_gamma = timestamp(known_gamma)
        if new_gamma and new_gamma > now + timedelta(minutes=5):
            return "incoming gamma timestamp is in the future; preserved"
        if previous_gamma and (not new_gamma or new_gamma < previous_gamma):
            return "incoming gamma revision would regress; preserved"
        gamma_fields = GAMMA_FIELDS
        if new_source > max(old_sources):
            # referencePrice can also advance with the ordinary snapshot.
            gamma_fields = gamma_fields - {"currentPrice"}
        gamma_changed = bool(changed & gamma_fields)
        if gamma_changed:
            if gamma_cache_changed and new_source == max(old_sources):
                return "cache edited outside local updater; gamma-only age unknown; preserved"
            # Legacy/manual payloads have no gamma revision in the public schema.
            # Their observation timestamps are a conservative lower bound: only
            # a gamma revision AFTER that observation can replace those values.
            # For a verified unchanged row we wrote, use the exact recorded gamma
            # revision instead, so delayed upstream releases are not misclassified.
            if previous_gamma is None:
                observations = [timestamp(row.get("fetched_at")), timestamp(old.get("fetchedAt"))]
                if not all(observations):
                    return "unknown manual gamma observation timestamp; preserved"
                previous_gamma = max(*observations, *old_sources)
            if new_gamma is None or new_gamma <= previous_gamma:
                return "gamma changed without a provably newer revision; preserved"
        if new_source == max(old_sources):
            if not changed:
                return "incoming data is unchanged; preserved"
            if not gamma_changed or changed - GAMMA_FIELDS:
                return "snapshot values changed without a newer snapshot revision; preserved"
            return "update"
    return "update"


def fetch_options(ticker, token):
    if (not token or token.startswith(("access_token=", "cf_clearance="))
            or not re.fullmatch(r"[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+", token)):
        raise SafeError("Configure only the application token value in UPSTREAM_ACCESS_TOKEN.")
    raw = request_json(
        f"https://saveticker.com/api/stocks/api/v1/tickers/{ticker}/options",
        {"Accept": "application/json", "Cookie": "access_token=" + token,
         "Referer": f"https://saveticker.com/company/{ticker}",
         "User-Agent": "SpyConverterSaveTickerEdge/1.0 (+https://spyconverter.com)"},
        f"Options {ticker}",
    )
    try:
        validate_source_payload(raw, ticker)
        payload = OptionsPayload(normalize_options(raw, ticker), raw.get("gammaUpdatedAt"))
        payload["fetchedAt"] = datetime.now(timezone.utc).isoformat()
        json.dumps(payload, allow_nan=False)
    except (ValueError, TypeError, OverflowError, AttributeError):
        raise SafeError(f"Options {ticker}: invalid Options schema; existing row preserved.") from None
    return payload


def within_options_refresh_window(now=None):
    pacific = (now or datetime.now(timezone.utc)).astimezone(ZoneInfo("America/Los_Angeles"))
    minutes = pacific.hour * 60 + pacific.minute
    return pacific.weekday() < 5 and 5 * 60 + 30 <= minutes < 14 * 60


def run_options(db, token, *, dry_run=False):
    if not within_options_refresh_window():
        log("Options: skipped outside weekdays 05:30–14:00 Pacific")
        return 0
    failures = 0
    revisions = OptionsRevisions(ROOT / ".local-fallback/options-revisions.json")
    for ticker in allowed_tickers():
        try:
            row = db.options_row(ticker)
            status = options_status(row, datetime.now(timezone.utc))
            if status != "stale":
                log(f"Options {ticker}: skipped because {status}")
                continue
            # A run may cross 14:00 while processing the earlier tickers.
            if not within_options_refresh_window():
                log("Options: refresh window closed; remaining fetches skipped")
                break
            incoming = fetch_options(ticker, token)
            # Reread before every decision/write, including after upstream HTTP.
            row = db.options_row(ticker)
            decision = options_decision(row, incoming, datetime.now(timezone.utc),
                                        revisions.matching_gamma(row), revisions.cache_changed(row))
            if decision != "update":
                log(f"Options {ticker}: skipped because {decision}")
            elif dry_run:
                log(f"Options {ticker}: dry-run, would update stale cache with newer source data")
            else:
                incoming["fetchedAt"] = datetime.now(timezone.utc).isoformat()
                changed = db.save_options(ticker, incoming, row)
                if changed:
                    verified = db.options_row(ticker)
                    if verified and verified.get("payload") == incoming:
                        try:
                            revisions.remember(verified, incoming)
                        except (OSError, ValueError):
                            log(f"Options {ticker}: revision metadata unavailable; future comparisons fail closed")
                        log(f"Options {ticker}: updated stale cache with newer source data; verified")
                    else:
                        log(f"Options {ticker}: row changed again after update; preserved subsequent write")
                else:
                    log(f"Options {ticker}: skipped because cache changed concurrently")
        except SafeError as error:
            if isinstance(error, RunTimeout):
                raise
            log(str(error))
            failures += 1
            # Never continue Options when the controlled SPY request fails.
            if ticker == "SPY":
                break
    return failures


def is_recent(value, now):
    normalized = normalize_timestamp(value)
    if not normalized:
        return False
    return datetime.fromisoformat(normalized.replace("Z", "+00:00")) > now - STALE_AFTER


def normalize_news_row(raw):
    item = normalize_item(raw)
    if not item:
        return None
    # Match the production stripHtml/isLikelyEnglish guard after reusing the
    # existing Python translation, date, source and ticker normalization.
    title = item["title"]
    for entity, char in (("&nbsp;", " "), ("&amp;", "&"), ("&quot;", '"'),
                         ("&#39;", "'"), ("&lt;", "<"), ("&gt;", ">")):
        title = title.replace(entity, char)
    title = re.sub(r"\s+", " ", re.sub(r"<[^>]*>", " ", title)).strip()[:300]
    if (not title or re.search(r"[\uac00-\ud7af]", title)
            or sum(ord(c) < 128 for c in title) / len(title) < 0.88):
        return None
    return {
        "title": title, "summary": "", "original_url": None,
        "external_id": item["id"], "source": item["source"],
        "source_type": "wire" if item["sourceSlug"] == "reuters" else "terminal",
        "published_at": item["publishedAt"], "tickers": item["tickers"],
        "headline_only": item["headlineOnly"],
    }


def run_news(db, *, dry_run=False):
    now = datetime.now(timezone.utc)
    stale = []
    for source in SOURCE_LABELS.values():
        if db.news_fresh(source, now):
            log(f"{source}: skipped because fresh")
        else:
            stale.append(source)
    if not stale:
        return
    incoming = {}
    # Both endpoints contain a mix of sources. Fetch in the requested 1,6 order,
    # then filter by the independently stale source, never by label-group alone.
    for group, endpoint in zip((1, 6), LIST_ENDPOINTS):
        payload = request_json(endpoint, NEWS_HEADERS, f"News group {group}")
        if not isinstance(payload, dict) or not isinstance(payload.get("news_list"), list):
            raise SafeError(f"News group {group}: unexpected schema; no News writes.")
        for raw in payload["news_list"]:
            row = normalize_news_row(raw) if isinstance(raw, dict) else None
            if row and row["source"] in stale:
                incoming.setdefault((row["source"], row["external_id"]), row)
    for source in stale:
        # Recheck after HTTP work to defer to automation/manual inserts.
        if db.news_fresh(source, datetime.now(timezone.utc)):
            log(f"{source}: skipped because fresh on recheck")
            continue
        rows = [row for row in incoming.values() if row["source"] == source]
        if not rows:
            log(f"{source}: no usable incoming rows; existing rows preserved")
            continue
        existing = db.existing_news_ids(source, [row["external_id"] for row in rows])
        new = [row for row in rows if row["external_id"] not in existing]
        if dry_run:
            log(f"{source}: dry-run, stale, would insert {len(new)} new articles")
        elif new:
            if db.news_fresh(source, datetime.now(timezone.utc)):
                log(f"{source}: skipped because fresh before insert")
                continue
            inserted = db.insert_news(new)
            log(f"{source}: updated because stale, inserted {len(inserted)} new articles")
        else:
            log(f"{source}: stale, 0 new articles; existing rows preserved")


@contextmanager
def single_run():
    state = ROOT / ".local-fallback"
    state.mkdir(mode=0o700, exist_ok=True)
    with (state / "run.lock").open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SafeError("Skipped: another local fallback run is active.") from None
        yield


def timeout_handler(signum, frame):
    raise RunTimeout("Run timeout reached; stopped.")


def main():
    global LOGGER
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="No Supabase writes")
    parser.add_argument("--scheduled", action="store_true", help="Write bounded, safe local logs")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--news-only", action="store_true")
    group.add_argument("--options-only", action="store_true")
    args = parser.parse_args()
    try:
        if args.scheduled:
            state = ROOT / ".local-fallback"
            state.mkdir(mode=0o700, exist_ok=True)
            handler = RotatingFileHandler(state / "fallback.log", maxBytes=1_000_000, backupCount=3)
            LOGGER = logging.getLogger("spyconverter-fallback")
            LOGGER.setLevel(logging.INFO)
            LOGGER.addHandler(handler)
        with single_run():
            signal.signal(signal.SIGALRM, timeout_handler)
            signal.alarm(RUN_TIMEOUT)
            credentials = load_credentials()
            db = Database(credentials)
            failures = 0
            if not args.options_only:
                try:
                    run_news(db, dry_run=args.dry_run)
                except SafeError as error:
                    if isinstance(error, RunTimeout):
                        raise
                    log(str(error))
                    failures += 1
            if not args.news_only:
                failures += run_options(db, credentials.get("UPSTREAM_ACCESS_TOKEN"), dry_run=args.dry_run)
            log(f"Run complete: mode={'dry-run' if args.dry_run else 'live'}, failures={failures}")
            return 1 if failures else 0
    except SafeError as error:
        log(str(error))
        return 1
    except Exception:
        # Never emit tracebacks that could include requests, secrets, or payloads.
        log("Unexpected local updater failure; no sensitive diagnostics logged.")
        return 1
    finally:
        signal.alarm(0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
