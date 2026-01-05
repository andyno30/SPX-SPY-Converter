/// <reference lib="deno.ns" />
import yahooFinance from "npm:yahoo-finance2";

type Ticker = "SPX" | "SPY" | "ES" | "NQ" | "QQQ" | "NDX";

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

// Tiny in-memory cache (30s)
let lastFetch: { at: number; body: any } | null = null;
const TTL_MS = 60_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
  if (req.method !== "GET") return cors(new Response("Method Not Allowed", { status: 405 }));

  const now = Date.now();
  if (lastFetch && now - lastFetch.at < TTL_MS) {
    return cors(new Response(JSON.stringify(lastFetch.body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  }

  try {
    const quotes = await yahooFinance.quote(tickers);

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

    const prices: Record<Ticker, number | null> = {
      SPX: bySymbol[SYMBOLS.SPX] ?? null,
      SPY: bySymbol[SYMBOLS.SPY] ?? null,
      ES:  bySymbol[SYMBOLS.ES]  ?? null,
      NQ:  bySymbol[SYMBOLS.NQ]  ?? null,
      QQQ: bySymbol[SYMBOLS.QQQ] ?? null,
      NDX: bySymbol[SYMBOLS.NDX] ?? null,
    };

    const body = {
      Prices: prices,
      "SPX/SPY Ratio": safeDiv(prices.SPX, prices.SPY),
      "ES/SPY Ratio":  safeDiv(prices.ES,  prices.SPY),
      "NQ/QQQ Ratio":  safeDiv(prices.NQ,  prices.QQQ),
      "NDX/QQQ Ratio": safeDiv(prices.NDX, prices.QQQ),
      "ES/SPX Ratio":  safeDiv(prices.ES,  prices.SPX),
      Datetime: new Date().toISOString(),
    };

    lastFetch = { at: now, body };
    return cors(new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  } catch (err: any) {
    console.error("get-live-price-pro error:", err);

    // Detect Yahoo rate limit
    if (
      err.message?.includes("Too Many Requests") ||
      (err.response?.status === 429)
    ) {
      // Return last cached result if available, else error
      if (lastFetch) {
        return cors(new Response(JSON.stringify({
          ...lastFetch.body,
          Warning: "Using cached data due to Yahoo rate limit",
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return cors(new Response(JSON.stringify({ message: "Rate limited by Yahoo Finance" }), { status: 429 }));
    }

    return cors(new Response(JSON.stringify({ message: "Server error", error: err.message }), { status: 500 }));
  }
});

