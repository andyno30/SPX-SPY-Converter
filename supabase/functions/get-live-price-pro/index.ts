/// <reference lib="deno.ns" />
// /supabase/functions/get-live-price-pro/index.ts

import YahooFinance from "npm:yahoo-finance2";

type Ticker =
  | "SPX"
  | "SPY"
  | "ES"
  | "NQ"
  | "QQQ"
  | "NDX"
  | "RUT"
  | "IWM"
  | "RTY"
  | "DJX"
  | "DIA"
  | "YM";

/**
 * Symbol map for Yahoo Finance
 */
const SYMBOLS: Record<Ticker, string> = {
  SPX: "^GSPC",
  SPY: "SPY",
  ES: "ES=F",
  NQ: "NQ=F",
  QQQ: "QQQ",
  NDX: "^NDX",
  RUT: "^RUT",
  IWM: "IWM",
  RTY: "RTY=F", // /RTY futures
  DJX: "DJX",
  DIA: "DIA",
  YM: "YM=F", // /YM futures
};

function cors(res: Response) {
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set(
    "Access-Control-Allow-Headers",
    "authorization, x-client-info, apikey, content-type"
  );
  h.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  return new Response(res.body, { status: res.status, headers: h });
}

const tickers = Object.values(SYMBOLS);
const safeDiv = (a: number | null, b: number | null) =>
  typeof a === "number" && typeof b === "number" && b !== 0 ? a / b : null;

// In-memory cache + request dedupe (per warm Edge instance)
let cache: any | null = null;
let cacheTime = 0;
let inFlight: Promise<any> | null = null;
const CACHE_MS = 60_000;

function json(body: unknown, status = 200) {
  return cors(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

async function fetchPricesFromYahoo() {
  // create instance for v3
  const yf = new YahooFinance();

  const quotes = await yf.quote(tickers); // array result
  const bySymbol: Record<string, number | null> = {};

  for (const q of quotes) {
    const price =
      (q as any).regularMarketPrice ??
      (q as any).postMarketPrice ??
      (q as any).preMarketPrice ??
      (q as any).previousClose ??
      null;

    if ((q as any).symbol) {
      bySymbol[(q as any).symbol] = typeof price === "number" ? price : null;
    }
  }

  // Map back to your tickers
  const prices: Record<Ticker, number | null> = {
    SPX: bySymbol[SYMBOLS.SPX] ?? null,
    SPY: bySymbol[SYMBOLS.SPY] ?? null,
    ES: bySymbol[SYMBOLS.ES] ?? null,
    NQ: bySymbol[SYMBOLS.NQ] ?? null,
    QQQ: bySymbol[SYMBOLS.QQQ] ?? null,
    NDX: bySymbol[SYMBOLS.NDX] ?? null,
    RUT: bySymbol[SYMBOLS.RUT] ?? null,
    IWM: bySymbol[SYMBOLS.IWM] ?? null,
    RTY: bySymbol[SYMBOLS.RTY] ?? null,
    DJX: bySymbol[SYMBOLS.DJX] ?? null,
    DIA: bySymbol[SYMBOLS.DIA] ?? null,
    YM: bySymbol[SYMBOLS.YM] ?? null,
  };

  // Keep existing ratio fields expected by frontend
  return {
    Prices: prices,
    "SPX/SPY Ratio": safeDiv(prices.SPX, prices.SPY),
    "ES/SPY Ratio": safeDiv(prices.ES, prices.SPY),
    "NQ/QQQ Ratio": safeDiv(prices.NQ, prices.QQQ),
    "NDX/QQQ Ratio": safeDiv(prices.NDX, prices.QQQ),
    "ES/SPX Ratio": safeDiv(prices.ES, prices.SPX),
    Datetime: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
  if (req.method !== "GET") return cors(new Response("Method Not Allowed", { status: 405 }));

  const now = Date.now();
  // 1) Return cache if fresh
  if (cache && now - cacheTime < CACHE_MS) {
    return json(cache, 200);
  }

  let startedFetch = false;
  try {
    // 2) Deduplicate concurrent requests
    if (inFlight) {
      const data = await inFlight;
      return json(data, 200);
    }

    // 3) Fetch once
    startedFetch = true;
    inFlight = fetchPricesFromYahoo();
    const data = await inFlight;

    // Update cache
    cache = data;
    cacheTime = Date.now();

    return json(data, 200);
  } catch (err) {
    console.error("get-live-price-pro error:", err);
    return json({ message: "Server error" }, 500);
  } finally {
    // Reset dedupe latch for next fresh request window
    if (startedFetch) {
      inFlight = null;
    }
  }
});
