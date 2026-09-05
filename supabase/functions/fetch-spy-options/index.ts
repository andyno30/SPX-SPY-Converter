/// <reference lib="deno.ns" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchSaveTickerJson } from "../_shared/saveticker.ts";

const PROJECT_URL = Deno.env.get("PROJECT_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const supabase = createClient(PROJECT_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PUBLIC_TICKER = "SPY";
const ALLOWED_TICKERS = new Set([
  "SPY",
  "QQQ",
  "IWM",
  "AAPL",
  "META",
  "AMZN",
  "MSFT",
  "GOOG",
  "GOOGL",
  "NVDA",
  "TSLA",
  "AMD",
  "TLT",
  "MU",
  "SNDK",
  "SNAP",
  "XYZ",
]);
const SPY_STATIC_FALLBACK_URL =
  "https://raw.githubusercontent.com/andyno30/SPX-SPY-Converter/main/data/spy-options.json";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function tickerFromRequest(req: Request): string | null {
  const ticker = new URL(req.url).searchParams.get("ticker")?.trim().toUpperCase() || PUBLIC_TICKER;
  return ALLOWED_TICKERS.has(ticker) ? ticker : null;
}

async function hasProAccess(req: Request): Promise<"allowed" | "missing-auth" | "pro-required"> {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return "missing-auth";

  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) return "missing-auth";

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_subscribed")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Options subscription lookup failed.", profileError.message);
    return "pro-required";
  }

  return profile?.is_subscribed ? "allowed" : "pro-required";
}

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

function validateSourcePayload(value: unknown, ticker: string): asserts value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SaveTicker returned a non-object options payload.");
  }

  const data = value as Record<string, any>;
  if (data.symbol !== undefined && data.symbol !== ticker) {
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

function normalize(data: Record<string, any>, ticker: string): Record<string, unknown> {
  const netGex = data.gammaPer1Pct;

  return {
    symbol: data.symbol || ticker,
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

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
  isPrivate = false,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": isPrivate
        ? "private, no-store"
        : "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
      "Vary": "Authorization",
      ...extraHeaders,
    },
  });
}

async function spyStaticFallback(): Promise<Record<string, unknown>> {
  const response = await fetch(SPY_STATIC_FALLBACK_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Static options fallback returned HTTP ${response.status}.`);

  return await response.json();
}

async function savePrivateCache(ticker: string, payload: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("options_cache").upsert({
    ticker,
    payload,
    source_updated_at: payload.sourceUpdatedAt || null,
    fetched_at: new Date().toISOString(),
  });
  if (error) console.error(`Could not cache ${ticker} options.`, error.message);
}

async function privateCacheFallback(ticker: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("options_cache")
    .select("payload")
    .eq("ticker", ticker)
    .maybeSingle();

  if (error || !data?.payload) {
    throw new Error(`No private ${ticker} options cache is available.`);
  }
  return data.payload as Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  const ticker = tickerFromRequest(req);
  if (!ticker) {
    return jsonResponse({ error: "Unsupported options ticker." }, 400);
  }

  const isPremiumTicker = ticker !== PUBLIC_TICKER;
  if (isPremiumTicker) {
    const access = await hasProAccess(req);
    if (access === "missing-auth") {
      return jsonResponse(
        { error: "Sign in to access this options ticker.", code: "AUTH_REQUIRED" },
        401,
        {},
        true,
      );
    }
    if (access === "pro-required") {
      return jsonResponse(
        { error: "SpyConverter Pro is required for this options ticker.", code: "PRO_REQUIRED" },
        403,
        {},
        true,
      );
    }
  }

  const apiUrl = `https://saveticker.com/api/stocks/api/v1/tickers/${ticker}/options`;
  const referer = `https://saveticker.com/company/${ticker}`;

  try {
    const payload = await fetchSaveTickerJson(apiUrl, referer);
    validateSourcePayload(payload, ticker);
    const normalized = normalize(payload, ticker);
    await savePrivateCache(ticker, normalized);
    return jsonResponse(
      normalized,
      200,
      {
        "X-SpyConverter-Data-Source": "saveticker-live",
        "X-SpyConverter-Ticker": ticker,
      },
      isPremiumTicker,
    );
  } catch (error) {
    console.error(
      `Live SaveTicker ${ticker} options fetch failed; using the cache fallback.`,
      error instanceof Error ? error.message : "Unknown error",
    );

    try {
      const payload = isPremiumTicker
        ? await privateCacheFallback(ticker)
        : await spyStaticFallback();
      return jsonResponse(
        payload,
        200,
        {
          "X-SpyConverter-Data-Source": isPremiumTicker
            ? "private-cache"
            : "static-fallback",
          "X-SpyConverter-Ticker": ticker,
        },
        isPremiumTicker,
      );
    } catch {
      return jsonResponse(
        { error: `${ticker} options data is temporarily unavailable.` },
        503,
        {},
        isPremiumTicker,
      );
    }
  }
});
