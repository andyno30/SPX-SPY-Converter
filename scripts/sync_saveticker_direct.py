#!/usr/bin/env python3
"""Fetch SaveTicker's authenticated SPY options payload into public JSON.

The script only writes the normalized public file after a successful response
and schema check. A failed or expired session therefore leaves the last known-
good dashboard data untouched.
"""

import asyncio
import json
import math
import os
import tempfile
from pathlib import Path

from playwright.async_api import async_playwright


ROOT = Path(__file__).resolve().parents[1]
AUTH_FILE = Path(os.environ.get("SAVETICKER_AUTH_FILE", ROOT / "saveticker-auth.json"))
OUTPUT_FILE = ROOT / "data" / "spy-options.json"
API_URL = "https://saveticker.com/api/stocks/api/v1/tickers/SPY/options"


def compact_number(value):
    if value is None:
        return None

    number = float(value)
    if not math.isfinite(number):
        return None

    sign = "-" if number < 0 else ""
    number = abs(number)
    if number >= 1_000_000_000:
        return f"{sign}{number / 1_000_000_000:.1f}B"
    if number >= 1_000_000:
        return f"{sign}{number / 1_000_000:.1f}M"
    if number >= 1_000:
        return f"{sign}{number / 1_000:.1f}K"
    return f"{sign}{number:.0f}"


def pct_share(obj, key):
    if not isinstance(obj, dict) or obj.get(key) is None:
        return None
    return round(float(obj[key]), 1)


def relative_volume(data, window):
    live = data.get("optionVolumeVsAvg") or {}
    windows = live.get("windows") or {}
    item = windows.get(window) or {}

    if item.get("available") and item.get("ratioPct") is not None:
        return round(float(item["ratioPct"]), 1)

    fallback_key = {"d3": "vsAvg3d", "d7": "vsAvg7d", "d30": "vsAvg30d"}[window]
    fallback = data.get(fallback_key)
    if fallback is None:
        return None
    return round(float(fallback) * 100, 1)


def validate_source_payload(data):
    if not isinstance(data, dict):
        raise ValueError("SaveTicker returned a non-object JSON payload.")

    if data.get("symbol") not in (None, "SPY"):
        raise ValueError("SaveTicker returned data for an unexpected symbol.")

    required_fields = (
        "referencePrice",
        "nearestExpiry",
        "maxPain",
        "putCallRatioVolume",
        "putCallRatioOpenInterest",
        "volume",
        "callWall",
        "putWall",
        "gammaFlip",
        "gammaPer1Pct",
    )
    missing = [field for field in required_fields if field not in data]
    if missing:
        raise ValueError(
            "SaveTicker payload is missing expected fields: " + ", ".join(missing)
        )

    for field in ("volumeShare", "openInterestShare", "premiumShare"):
        if not isinstance(data.get(field), dict):
            raise ValueError(f"SaveTicker payload has no valid {field} object.")


def normalize(data):
    """Map SaveTicker's private response to the public page's stable schema."""
    source_updated_at = data.get("snapshotUpdatedAt") or data.get("batchUpdatedAt")
    net_gex = data.get("gammaPer1Pct")

    return {
        "symbol": data.get("symbol") or "SPY",
        "source": "Unusual Whales",
        "sourceUpdatedAt": source_updated_at,
        "asOf": data.get("asOf"),
        "isPriorDay": bool(
            data.get("snapshotIsPriorDay") or data.get("batchIsPriorDay")
        ),
        "currentPrice": data.get("referencePrice"),
        "nearestExpiry": data.get("nearestExpiry"),
        "daysToExpiry": data.get("daysToExpiry"),
        "maxPain": data.get("maxPain"),
        "putCallRatioVolume": data.get("putCallRatioVolume"),
        "putCallRatioOpenInterest": data.get("putCallRatioOpenInterest"),
        "volumeSplit": {
            "call": pct_share(data.get("volumeShare"), "call"),
            "put": pct_share(data.get("volumeShare"), "put"),
        },
        "openInterestSplit": {
            "call": pct_share(data.get("openInterestShare"), "call"),
            "put": pct_share(data.get("openInterestShare"), "put"),
        },
        "premiumSplit": {
            "call": pct_share(data.get("premiumShare"), "call"),
            "put": pct_share(data.get("premiumShare"), "put"),
        },
        "totalOptionVolume": data.get("volume"),
        "totalOptionVolumeFormatted": compact_number(data.get("volume")),
        "relativeVolume": {
            "3d": relative_volume(data, "d3"),
            "7d": relative_volume(data, "d7"),
            "30d": relative_volume(data, "d30"),
        },
        "callWall": data.get("callWall"),
        "putWall": data.get("putWall"),
        "gammaFlip": data.get("gammaFlip"),
        # SaveTicker's visible Net GEX card maps to gammaPer1Pct, not
        # netGammaExposure. Keep this mapping aligned with the handoff.
        "netGex": net_gex,
        "netGexFormatted": compact_number(net_gex),
        "nextPollAfterMs": data.get("nextPollAfterMs"),
        "rawNetGammaExposure": data.get("netGammaExposure"),
    }


def write_public_json(payload):
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=OUTPUT_FILE.parent,
            prefix=".spy-options-",
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


async def fetch_source_payload():
    if not AUTH_FILE.exists():
        raise SystemExit(
            f"Missing {AUTH_FILE.name}. Run scripts/refresh_saveticker_auth.py first."
        )

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        try:
            context = await browser.new_context(storage_state=str(AUTH_FILE))
            response = await context.request.get(
                API_URL,
                headers={
                    "Accept": "application/json",
                    "Referer": "https://saveticker.com/company/SPY",
                },
            )

            if response.status == 401:
                raise SystemExit(
                    "SaveTicker returned HTTP 401: the saved login session expired. "
                    "Run scripts/refresh_saveticker_auth.py and update the "
                    "SAVETICKER_AUTH_JSON_B64 GitHub secret."
                )

            if not response.ok:
                raise SystemExit(
                    f"SaveTicker API returned HTTP {response.status}; "
                    "the previous public data was preserved."
                )

            payload = await response.json()
            validate_source_payload(payload)
            return payload
        finally:
            await browser.close()


async def main():
    source_payload = await fetch_source_payload()
    normalized = normalize(source_payload)
    write_public_json(normalized)

    print(
        "SPY options update succeeded: "
        f"snapshot={normalized.get('asOf') or 'unknown'}, "
        f"source_updated={normalized.get('sourceUpdatedAt') or 'unknown'}"
    )
    print(f"Saved {OUTPUT_FILE.relative_to(ROOT)}")


if __name__ == "__main__":
    asyncio.run(main())
