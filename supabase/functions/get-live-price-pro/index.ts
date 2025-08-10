/// <reference lib="deno.ns" />
// /supabase/functions/get-live-price-pro/index.ts
// NOTE: unpinned import to avoid "could not find package" error
import yahooFinance from "npm:yahoo-finance2";

type Ticker = "SPX" | "SPY" | "ES" | "NQ" | "QQQ" | "NDX";

/**
 * Symbol map for Yahoo Finance
 * SPX  -> ^GSPC (S&P 500 Index)
 * SPY  -> SPY (ETF)
 * ES   -> ES=F (E-mini S&P 500 Futures)
 * NQ   -> NQ=F (E-mini Nasdaq 100 Futures)
 * QQQ  -> QQQ (ETF)
 * NDX  -> ^NDX (Nasdaq 100 Index)
 */
const SYMBOLS: Record<Ticker, string> = {
  SPX: "^GSPC",
  SPY: "SPY",
  ES: "ES=F",
  NQ: "NQ=F",
  QQQ: "QQQ",
  NDX: "^NDX",
};

function cors(res: Response) {
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
  h.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  return new Response(res.body, { status: res.status, headers: h });
}

const tickers = Object.values(SYMBOLS);
const safeDiv = (a: number | null, b: number | null) =>
  typeof a === "number" && typeof b === "number" && b !== 0 ? a / b : null;

// Optional tiny in-memory cache to be gentle on Yahoo (30s)
let lastFetch: { at: number; body: any } | null = null;
const TTL_MS = 30_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
  if (req.method !== "GET") return cors(new Response("Method Not Allowed", { status: 405 }));

  // Return cached response if fresh
  const now = Date.now();
  if (lastFetch && now - lastFetch.at < TTL_MS) {
    return cors(new Response(JSON.stringify(lastFetch.body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  }

  try {
    const quotes = await yahooFinance.quote(tickers); // array result
    const bySymbol: Record<string, number | null> = {};
    for (const q of quotes) {
      const price =
        (q as any).regularMarketPrice ??
        (q as any).postMarketPrice ??
        (q as any).preMarketPrice ??
        (q as any).previousClose ??
        null;
      if ((q as any).symbol) bySymbol[(q as any).symbol] = typeof price === "number" ? price : null;
    }

    // Map back to your tickers
    const prices: Record<Ticker, number | null> = {
      SPX: bySymbol[SYMBOLS.SPX] ?? null,
      SPY: bySymbol[SYMBOLS.SPY] ?? null,
      ES:  bySymbol[SYMBOLS.ES]  ?? null,
      NQ:  bySymbol[SYMBOLS.NQ]  ?? null,
      QQQ: bySymbol[SYMBOLS.QQQ] ?? null,
      NDX: bySymbol[SYMBOLS.NDX] ?? null,
    };

    // Compute the exact fields your frontend expects
    const body = {
      Prices: prices,
      "SPX/SPY Ratio": safeDiv(prices.SPX, prices.SPY),
      "ES/SPY Ratio":  safeDiv(prices.ES,  prices.SPY),
      "NQ/QQQ Ratio":  safeDiv(prices.NQ,  prices.QQQ),
      "NDX/QQQ Ratio": safeDiv(prices.NDX, prices.QQQ),
      "ES/SPX Ratio":  safeDiv(prices.ES,  prices.SPX),
      Datetime: new Date().toISOString(), // UTC
    };

    lastFetch = { at: now, body };

    return cors(new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  } catch (err) {
    console.error("get-live-price-pro error:", err);
    return cors(new Response(JSON.stringify({ message: "Server error" }), { status: 500 }));
  }
});
