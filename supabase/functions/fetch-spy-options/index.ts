/// <reference lib="deno.ns" />

import { fetchSaveTickerJson } from "../_shared/saveticker.ts";

const API_URL = "https://saveticker.com/api/stocks/api/v1/tickers/SPY/options";
const REFERER = "https://saveticker.com/company/SPY";
const STATIC_FALLBACK_URL =
  "https://raw.githubusercontent.com/andyno30/SPX-SPY-Converter/main/data/spy-options.json";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

function compactNumber(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;

  const sign = number < 0 ? "-" : "";
  const absolute = Math.abs(number);
  if (absolute >= 1_000_000_000) return `${sign}${(absolute / 1_000_000_000).toFixed(1)}B`;
  if (absolute >= 1_000_000) return `${sign}${(absolute / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${sign}${(absolute / 1_000).toFixed(1)}K`;
  return `${sign}${absolute.toFixed(0)}`;
}

function percentageShare(value: unknown, key: string): number | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as Record<string, unknown>)[key];
  const number = Number(raw);
  return raw === null || raw === undefined || !Number.isFinite(number)
    ? null
    : Math.round(number * 10) / 10;
}

function relativeVolume(data: Record<string, any>, window: "d3" | "d7" | "d30"): number | null {
  const live = data.optionVolumeVsAvg?.windows?.[window];
  if (live?.available && live.ratioPct !== null && live.ratioPct !== undefined) {
    const ratio = Number(live.ratioPct);
    if (Number.isFinite(ratio)) return Math.round(ratio * 10) / 10;
  }

  const fallbackKey = { d3: "vsAvg3d", d7: "vsAvg7d", d30: "vsAvg30d" }[window];
  const fallback = Number(data[fallbackKey]);
  return Number.isFinite(fallback) ? Math.round(fallback * 1_000) / 10 : null;
}

function validateSourcePayload(value: unknown): asserts value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SaveTicker returned a non-object options payload.");
  }

  const data = value as Record<string, any>;
  if (data.symbol !== undefined && data.symbol !== "SPY") {
    throw new Error("SaveTicker returned options for an unexpected symbol.");
  }

  const requiredFields = [
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
  ];
  const missing = requiredFields.filter((field) => !(field in data));
  if (missing.length > 0) {
    throw new Error(`SaveTicker options is missing fields: ${missing.join(", ")}.`);
  }

  for (const field of ["volumeShare", "openInterestShare", "premiumShare"]) {
    if (!data[field] || typeof data[field] !== "object") {
      throw new Error(`SaveTicker options has no valid ${field} object.`);
    }
  }
}

function normalize(data: Record<string, any>): Record<string, unknown> {
  const netGex = data.gammaPer1Pct;

  return {
    symbol: data.symbol || "SPY",
    source: "Unusual Whales",
    sourceUpdatedAt: data.snapshotUpdatedAt || data.batchUpdatedAt || null,
    fetchedAt: new Date().toISOString(),
    asOf: data.asOf || null,
    isPriorDay: Boolean(data.snapshotIsPriorDay || data.batchIsPriorDay),
    currentPrice: data.referencePrice,
    nearestExpiry: data.nearestExpiry,
    daysToExpiry: data.daysToExpiry,
    maxPain: data.maxPain,
    putCallRatioVolume: data.putCallRatioVolume,
    putCallRatioOpenInterest: data.putCallRatioOpenInterest,
    volumeSplit: {
      call: percentageShare(data.volumeShare, "call"),
      put: percentageShare(data.volumeShare, "put"),
    },
    openInterestSplit: {
      call: percentageShare(data.openInterestShare, "call"),
      put: percentageShare(data.openInterestShare, "put"),
    },
    premiumSplit: {
      call: percentageShare(data.premiumShare, "call"),
      put: percentageShare(data.premiumShare, "put"),
    },
    totalOptionVolume: data.volume,
    totalOptionVolumeFormatted: compactNumber(data.volume),
    relativeVolume: {
      "3d": relativeVolume(data, "d3"),
      "7d": relativeVolume(data, "d7"),
      "30d": relativeVolume(data, "d30"),
    },
    callWall: data.callWall,
    putWall: data.putWall,
    gammaFlip: data.gammaFlip,
    netGex,
    netGexFormatted: compactNumber(netGex),
    nextPollAfterMs: data.nextPollAfterMs,
    rawNetGammaExposure: data.netGammaExposure,
  };
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
      ...extraHeaders,
    },
  });
}

async function staticFallback(): Promise<Response> {
  const response = await fetch(STATIC_FALLBACK_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Static options fallback returned HTTP ${response.status}.`);

  const payload = await response.json();
  return jsonResponse(payload, 200, { "X-SpyConverter-Data-Source": "static-fallback" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  try {
    const payload = await fetchSaveTickerJson(API_URL, REFERER);
    validateSourcePayload(payload);
    return jsonResponse(normalize(payload), 200, {
      "X-SpyConverter-Data-Source": "saveticker-live",
    });
  } catch (error) {
    console.error(
      "Live SaveTicker options fetch failed; using the static fallback.",
      error instanceof Error ? error.message : "Unknown error",
    );

    try {
      return await staticFallback();
    } catch {
      return jsonResponse({ error: "SPY options data is temporarily unavailable." }, 503);
    }
  }
});
