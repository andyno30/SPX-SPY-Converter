#!/usr/bin/env python3
"""Cache safe Reuters and Financial Juice metadata from SaveTicker.

The authenticated SaveTicker response is private. This updater deliberately
publishes only the fields needed by SpyConverter's News UI and never requests,
stores, or logs Reuters article bodies.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AUTH_FILE = Path(os.environ.get("SAVETICKER_AUTH_FILE", ROOT / "saveticker-auth.json"))
OUTPUT_FILE = ROOT / "data" / "saveticker-news.json"
TIMEOUT_SECONDS = 20
MAX_ITEMS_PER_SOURCE = 300
MAX_TICKERS_PER_ITEM = 8

# These label-group meanings are intentionally not inferred. They are simply
# the two confirmed feeds that currently contain the requested source values.
LIST_ENDPOINTS = (
    "https://saveticker.com/api/news/list?"
    "page=1&page_size=100&sort=created_at_desc&label_group=1&label_name=1",
    "https://saveticker.com/api/news/list?"
    "page=1&page_size=100&sort=created_at_desc&label_group=6&label_name=1",
)

SOURCE_LABELS = {
    "reuters": "Reuters",
    "financial-juice": "Financial Juice",
}


def load_storage_state_cookies() -> str:
    if not AUTH_FILE.exists():
        raise SystemExit(
            f"Missing {AUTH_FILE.name}. Run scripts/refresh_saveticker_auth.py first."
        )

    try:
        storage_state = json.loads(AUTH_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit("The SaveTicker session file is unreadable or invalid JSON.") from error

    cookie_pairs = []
    for cookie in storage_state.get("cookies", []):
        if not isinstance(cookie, dict):
            continue
        name = cookie.get("name")
        value = cookie.get("value")
        domain = str(cookie.get("domain") or "").lstrip(".")
        if name and value and "saveticker.com".endswith(domain):
            cookie_pairs.append(f"{name}={value}")

    if not cookie_pairs:
        raise SystemExit(
            "The saved SaveTicker session has no usable cookies. Refresh authentication."
        )

    return "; ".join(cookie_pairs)


def fetch_news_list(url: str, cookie_header: str) -> list[dict]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "Cookie": cookie_header,
            "Referer": "https://saveticker.com/news",
            "User-Agent": "SpyConverterNewsUpdater/1.0",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            raise SystemExit(
                "SaveTicker authentication expired. Refresh the local session and update "
                "the SAVETICKER_AUTH_JSON_B64 GitHub secret."
            ) from error
        raise SystemExit(
            f"SaveTicker news returned HTTP {error.code}; the previous cache was preserved."
        ) from error
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise SystemExit(
            "SaveTicker news could not be fetched or decoded; the previous cache was preserved."
        ) from error

    if not isinstance(payload, dict) or not isinstance(payload.get("news_list"), list):
        raise SystemExit(
            "SaveTicker news returned an unexpected schema; the previous cache was preserved."
        )

    return [item for item in payload["news_list"] if isinstance(item, dict)]


def normalize_timestamp(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None

    raw = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def is_safe_english_fallback(value: object) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    # Never let a Korean fallback appear when the expected English field is absent.
    return re.search(r"[\uac00-\ud7af]", value) is None


def english_title(item: dict) -> str | None:
    translations = item.get("translations")
    translated = translations.get("translated") if isinstance(translations, dict) else None
    english = translated.get("en_US") if isinstance(translated, dict) else None
    title = english.get("title") if isinstance(english, dict) else None

    if not isinstance(title, str) or not title.strip():
        title = item.get("title")
        if not is_safe_english_fallback(title):
            return None

    return re.sub(r"\s+", " ", title).strip()[:300]


def normalize_tickers(value: object) -> list[str]:
    if not isinstance(value, list):
        return []

    tickers: list[str] = []
    for item in value:
        candidate = item if isinstance(item, str) else None
        if isinstance(item, dict):
            candidate = item.get("ticker") or item.get("symbol") or item.get("code")
        if not isinstance(candidate, str):
            continue

        normalized = candidate.strip().upper()
        if not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,9}", normalized):
            continue
        if normalized not in tickers:
            tickers.append(normalized)
        if len(tickers) >= MAX_TICKERS_PER_ITEM:
            break

    return tickers


def normalize_item(item: dict) -> dict | None:
    source_slug = str(item.get("source") or "").strip().lower()
    source_label = SOURCE_LABELS.get(source_slug)
    article_id = str(item.get("id") or "").strip()
    title = english_title(item)

    extra = item.get("extra") if isinstance(item.get("extra"), dict) else {}
    published_at = normalize_timestamp(extra.get("source_created_at"))
    if not published_at:
        published_at = normalize_timestamp(item.get("created_at"))

    if not source_label or not article_id or not title or not published_at:
        return None

    return {
        "id": article_id,
        "source": source_label,
        "sourceSlug": source_slug,
        "title": title,
        "publishedAt": published_at,
        "tickers": normalize_tickers(item.get("tickers")),
        "headlineOnly": bool(item.get("is_headline_only")),
        # No original publisher URL has been confirmed in the source payload.
        "url": None,
    }


def load_previous_items() -> list[dict]:
    if not OUTPUT_FILE.exists():
        return []

    try:
        payload = json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        return []

    # Whitelist the existing public shape instead of carrying arbitrary fields forward.
    normalized_items = []
    for item in items:
        if not isinstance(item, dict):
            continue
        source_slug = str(item.get("sourceSlug") or "").strip().lower()
        source_label = SOURCE_LABELS.get(source_slug)
        article_id = str(item.get("id") or "").strip()
        title = item.get("title")
        published_at = normalize_timestamp(item.get("publishedAt"))
        if not source_label or not article_id or not isinstance(title, str) or not published_at:
            continue
        normalized_items.append(
            {
                "id": article_id,
                "source": source_label,
                "sourceSlug": source_slug,
                "title": re.sub(r"\s+", " ", title).strip()[:300],
                "publishedAt": published_at,
                "tickers": normalize_tickers(item.get("tickers")),
                "headlineOnly": bool(item.get("headlineOnly")),
                "url": None,
            }
        )
    return normalized_items


def merge_items(previous: list[dict], incoming: list[dict]) -> list[dict]:
    by_key = {
        (item["sourceSlug"], item["id"]): item
        for item in previous
    }
    for item in incoming:
        by_key[(item["sourceSlug"], item["id"])] = item

    ordered = sorted(
        by_key.values(),
        key=lambda item: (item["publishedAt"], item["id"]),
        reverse=True,
    )

    retained: list[dict] = []
    source_counts = {source: 0 for source in SOURCE_LABELS}
    for item in ordered:
        source_slug = item["sourceSlug"]
        if source_counts[source_slug] >= MAX_ITEMS_PER_SOURCE:
            continue
        retained.append(item)
        source_counts[source_slug] += 1

    return retained


def write_cache(items: list[dict]) -> None:
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "items": items,
    }

    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=OUTPUT_FILE.parent,
            prefix=".saveticker-news-",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temp_path = Path(handle.name)
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        temp_path.replace(OUTPUT_FILE)
    except Exception:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
        raise


def main() -> None:
    cookie_header = load_storage_state_cookies()
    raw_items: list[dict] = []
    for endpoint in LIST_ENDPOINTS:
        raw_items.extend(fetch_news_list(endpoint, cookie_header))

    incoming = [normalized for item in raw_items if (normalized := normalize_item(item))]
    if not incoming:
        raise SystemExit(
            "No Reuters or Financial Juice records were found; the previous cache was preserved."
        )

    previous = load_previous_items()
    merged = merge_items(previous, incoming)
    if merged == previous:
        print(
            "SaveTicker news check succeeded: no new normalized Reuters or "
            "Financial Juice items."
        )
        return

    write_cache(merged)
    counts = {
        source: sum(1 for item in merged if item["sourceSlug"] == source)
        for source in SOURCE_LABELS
    }
    print(
        "SaveTicker news update succeeded: "
        f"Reuters={counts['reuters']}, Financial Juice={counts['financial-juice']}."
    )
    print(f"Saved {OUTPUT_FILE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
