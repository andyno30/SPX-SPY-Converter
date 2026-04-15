/// <reference lib="deno.ns" />

import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Supabase Edge Function: fetch-news
 *
 * Pulls English-only, U.S.-market-relevant headlines from free sources,
 * deduplicates by canonical URL, and inserts lightweight rows into
 * public.news_articles.
 */

const PROJECT_URL = Deno.env.get("PROJECT_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY");

if (!PROJECT_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Missing PROJECT_URL or SERVICE_ROLE_KEY edge function secrets.");
}

const FINNHUB_API_KEY = Deno.env.get("FINNHUB_API_KEY") ?? "";
const MARKETAUX_API_KEY = Deno.env.get("MARKETAUX_API_KEY") ?? "";

// Optional endpoint secrets for scheduler calls.
const FETCH_NEWS_SECRET = Deno.env.get("FETCH_NEWS_SECRET") ?? "";

// Optional feed URLs (leave blank to skip).
const FINANCIALJUICE_RSS_URL = Deno.env.get("FINANCIALJUICE_RSS_URL") ?? "";
const SAVETICKER_NEWS_RSS_URL = Deno.env.get("SAVETICKER_NEWS_RSS_URL") ?? "";

const supabase = createClient(PROJECT_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

type SourceType =
  | "wire"
  | "tv"
  | "regulator"
  | "government"
  | "aggregator"
  | "terminal"
  | "api";

interface NewsArticle {
  title: string;
  summary: string;
  original_url: string;
  source: string;
  source_type: SourceType;
  published_at: string;
  tickers: string[];
}

interface FetchResult {
  sourceKey: string;
  items: NewsArticle[];
}

interface SourceConfig {
  sourceKey: string;
  url: string;
  source: string;
  sourceType: SourceType;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TITLE_LEN = 300;
const MAX_SUMMARY_LEN = 500;
const MAX_TICKERS_PER_ARTICLE = 8;
const MAX_INSERT_CHUNK = 500;

const MARKET_KEYWORDS = [
  "spy",
  "spx",
  "s&p",
  "s&p 500",
  "dow",
  "nasdaq",
  "qqq",
  "russell",
  "federal reserve",
  "fed",
  "fomc",
  "interest rate",
  "inflation",
  "cpi",
  "ppi",
  "gdp",
  "jobless",
  "unemployment",
  "treasury",
  "yield",
  "bond market",
  "earnings",
  "guidance",
  "ipo",
  "sec",
  "merger",
  "acquisition",
  "buyback",
  "dividend",
  "wall street",
  "stock market",
  "equities",
  "macro",
  "tariff",
  "white house",
  "nvidia",
  "tesla",
  "apple",
  "amazon",
  "microsoft",
  "meta",
  "google",
];

const KNOWN_TICKERS = new Set([
  "SPY",
  "SPX",
  "QQQ",
  "DIA",
  "IWM",
  "NVDA",
  "TSLA",
  "AAPL",
  "AMZN",
  "MSFT",
  "META",
  "GOOGL",
  "GOOG",
  "AMD",
  "INTC",
  "AVGO",
  "NFLX",
  "PLTR",
  "SMCI",
  "COIN",
  "JPM",
  "GS",
  "BAC",
  "XOM",
  "CVX",
  "WMT",
  "UNH",
  "JNJ",
  "PFE",
]);

const SOURCE_ALLOWLIST = new Set([
  "Reuters",
  "CNBC",
  "FinancialJuice",
  "White House",
  "SEC",
  "Yahoo Finance",
  "Finnhub",
  "Marketaux",
  "Federal Reserve",
]);

const RSS_SOURCES: SourceConfig[] = [
  {
    sourceKey: "reuters_business",
    url: "https://feeds.reuters.com/reuters/businessNews",
    source: "Reuters",
    sourceType: "wire",
  },
  {
    sourceKey: "reuters_company",
    url: "https://feeds.reuters.com/reuters/companyNews",
    source: "Reuters",
    sourceType: "wire",
  },
  {
    sourceKey: "cnbc_top_news",
    url: "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    source: "CNBC",
    sourceType: "tv",
  },
  {
    sourceKey: "cnbc_markets",
    url: "https://www.cnbc.com/id/20910258/device/rss/rss.html",
    source: "CNBC",
    sourceType: "tv",
  },
  {
    sourceKey: "yahoo_finance",
    url: "https://finance.yahoo.com/news/rssindex",
    source: "Yahoo Finance",
    sourceType: "aggregator",
  },
  {
    sourceKey: "sec_press_releases",
    url: "https://www.sec.gov/rss/news/pressreleases.rss",
    source: "SEC",
    sourceType: "regulator",
  },
  {
    sourceKey: "white_house_briefing",
    url: "https://www.whitehouse.gov/briefing-room/feed/",
    source: "White House",
    sourceType: "government",
  },
  {
    sourceKey: "federal_reserve_press",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    source: "Federal Reserve",
    sourceType: "regulator",
  },
];

if (FINANCIALJUICE_RSS_URL) {
  RSS_SOURCES.push({
    sourceKey: "financialjuice",
    url: FINANCIALJUICE_RSS_URL,
    source: "FinancialJuice",
    sourceType: "terminal",
  });
}

if (SAVETICKER_NEWS_RSS_URL) {
  RSS_SOURCES.push({
    sourceKey: "saveticker_english",
    url: SAVETICKER_NEWS_RSS_URL,
    source: "SaveTicker",
    sourceType: "aggregator",
  });
}

function isLikelyEnglish(input: string): boolean {
  if (!input) return false;
  const sample = input.slice(0, 500);
  const asciiChars = sample.replace(/[^\x00-\x7F]/g, "").length;
  const asciiRatio = asciiChars / Math.max(sample.length, 1);
  return asciiRatio >= 0.88;
}

function isMarketRelevant(input: string): boolean {
  const text = input.toLowerCase();
  return MARKET_KEYWORDS.some((keyword) => text.includes(keyword));
}

function canonicalizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());

    // Remove common tracking params.
    for (const [key] of parsed.searchParams.entries()) {
      const lower = key.toLowerCase();
      if (
        lower.startsWith("utm_") ||
        lower === "gclid" ||
        lower === "fbclid" ||
        lower === "mc_cid" ||
        lower === "mc_eid" ||
        lower === "guccounter" ||
        lower === "guce_referrer" ||
        lower === "guce_referrer_sig"
      ) {
        parsed.searchParams.delete(key);
      }
    }

    parsed.hash = "";

    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    return parsed.toString();
  } catch {
    return "";
  }
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(input: string): string {
  return decodeEntities(input)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripCDATA(input: string): string {
  return input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1").trim();
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.trim() ?? "";
}

function extractLink(block: string): string {
  const hrefMatch = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (hrefMatch?.[1]) return hrefMatch[1].trim();

  const directLink = extractTag(block, "link");
  if (directLink) return stripCDATA(stripHtml(directLink));

  const guid = extractTag(block, "guid");
  if (guid) return stripCDATA(stripHtml(guid));

  const id = extractTag(block, "id");
  return id ? stripCDATA(stripHtml(id)) : "";
}

function parseDate(rawDate: string): string {
  if (!rawDate) return new Date().toISOString();
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function extractTickers(input: string): string[] {
  const found = new Set<string>();
  const text = input.toUpperCase();

  for (const match of text.matchAll(/\$([A-Z]{1,5})\b/g)) {
    found.add(match[1]);
  }

  for (const match of text.matchAll(/\b([A-Z]{1,5})\b/g)) {
    const candidate = match[1];
    if (KNOWN_TICKERS.has(candidate)) found.add(candidate);
  }

  return Array.from(found).slice(0, MAX_TICKERS_PER_ARTICLE);
}

function normalizeArticle(input: Partial<NewsArticle>): NewsArticle | null {
  const title = stripHtml(stripCDATA(input.title ?? "")).slice(0, MAX_TITLE_LEN).trim();
  const summary = stripHtml(stripCDATA(input.summary ?? ""))
    .slice(0, MAX_SUMMARY_LEN)
    .trim();
  const original_url = canonicalizeUrl(input.original_url ?? "");

  const source = (input.source ?? "").trim();
  const source_type = input.source_type;
  const published_at = parseDate(input.published_at ?? "");

  if (!title || !original_url || !source || !source_type) return null;
  if (!SOURCE_ALLOWLIST.has(source) && source !== "SaveTicker") return null;

  const relevanceText = `${title} ${summary}`;
  if (!isLikelyEnglish(relevanceText)) return null;

  // Keep regulator/government updates only when market relevant.
  if (!isMarketRelevant(relevanceText)) return null;

  const tickers = (input.tickers ?? [])
    .map((ticker) => ticker.toUpperCase().trim())
    .filter(Boolean)
    .slice(0, MAX_TICKERS_PER_ARTICLE);

  return {
    title,
    summary,
    original_url,
    source,
    source_type,
    published_at,
    tickers: tickers.length > 0 ? tickers : extractTickers(relevanceText),
  };
}

function dedupeBatch(articles: NewsArticle[]): NewsArticle[] {
  const seenUrls = new Set<string>();
  const deduped: NewsArticle[] = [];

  for (const article of articles) {
    if (seenUrls.has(article.original_url)) continue;
    seenUrls.add(article.original_url);
    deduped.push(article);
  }

  deduped.sort((a, b) => {
    return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
  });

  return deduped;
}

async function fetchJson(url: string): Promise<any | null> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    headers: {
      "User-Agent": "SpyConverterNewsBot/1.0 (+https://spyconverter.com)",
      Accept: "application/json",
    },
  });

  if (!response.ok) return null;
  return await response.json();
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    headers: {
      "User-Agent": "SpyConverterNewsBot/1.0 (+https://spyconverter.com)",
      Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return await response.text();
}

async function fetchFinnhub(): Promise<FetchResult> {
  if (!FINNHUB_API_KEY) {
    return { sourceKey: "finnhub", items: [] };
  }

  try {
    const endpoint = `https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_API_KEY}`;
    const data = await fetchJson(endpoint);
    if (!Array.isArray(data)) return { sourceKey: "finnhub", items: [] };

    const items = data
      .map((item: any) =>
        normalizeArticle({
          title: item.headline,
          summary: item.summary,
          original_url: item.url,
          source: item.source || "Finnhub",
          source_type: "api",
          published_at: item.datetime
            ? new Date(Number(item.datetime) * 1000).toISOString()
            : new Date().toISOString(),
          tickers: typeof item.related === "string"
            ? item.related
                .split(",")
                .map((ticker: string) => ticker.trim())
                .filter(Boolean)
            : [],
        }),
      )
      .filter((item: NewsArticle | null): item is NewsArticle => item !== null);

    return { sourceKey: "finnhub", items };
  } catch (error) {
    console.error("finnhub fetch failed", error);
    return { sourceKey: "finnhub", items: [] };
  }
}

async function fetchMarketaux(): Promise<FetchResult> {
  if (!MARKETAUX_API_KEY) {
    return { sourceKey: "marketaux", items: [] };
  }

  try {
    const publishedAfter = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const endpoint =
      "https://api.marketaux.com/v1/news/all" +
      `?api_token=${MARKETAUX_API_KEY}` +
      "&language=en" +
      "&countries=us" +
      "&filter_entities=true" +
      "&limit=100" +
      `&published_after=${encodeURIComponent(publishedAfter)}`;

    const json = await fetchJson(endpoint);
    const rows = Array.isArray(json?.data) ? json.data : [];

    const items = rows
      .map((item: any) =>
        normalizeArticle({
          title: item.title,
          summary: item.description,
          original_url: item.url,
          source: item.source || "Marketaux",
          source_type: "api",
          published_at: item.published_at,
          tickers: Array.isArray(item.entities)
            ? item.entities
                .map((entity: any) => String(entity?.symbol || "").trim())
                .filter(Boolean)
            : [],
        }),
      )
      .filter((item: NewsArticle | null): item is NewsArticle => item !== null);

    return { sourceKey: "marketaux", items };
  } catch (error) {
    console.error("marketaux fetch failed", error);
    return { sourceKey: "marketaux", items: [] };
  }
}

function parseRssEntries(xml: string, source: string, sourceType: SourceType): NewsArticle[] {
  const itemBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const entryBlocks = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  const blocks = [...itemBlocks, ...entryBlocks];

  return blocks
    .map((block) => {
      const title = extractTag(block, "title");
      const description =
        extractTag(block, "description") ||
        extractTag(block, "summary") ||
        extractTag(block, "content") ||
        extractTag(block, "content:encoded");
      const link = extractLink(block);
      const publishedAt =
        extractTag(block, "pubDate") ||
        extractTag(block, "published") ||
        extractTag(block, "updated") ||
        extractTag(block, "dc:date");

      return normalizeArticle({
        title,
        summary: description,
        original_url: link,
        source,
        source_type: sourceType,
        published_at: publishedAt,
        tickers: extractTickers(`${title} ${description}`),
      });
    })
    .filter((item: NewsArticle | null): item is NewsArticle => item !== null);
}

async function fetchRssSource(config: SourceConfig): Promise<FetchResult> {
  try {
    const xml = await fetchText(config.url);
    const items = parseRssEntries(xml, config.source, config.sourceType);
    return {
      sourceKey: config.sourceKey,
      items,
    };
  } catch (error) {
    console.error(`rss fetch failed for ${config.sourceKey}`, error);
    return {
      sourceKey: config.sourceKey,
      items: [],
    };
  }
}

function isAuthorized(req: Request): boolean {
  if (!FETCH_NEWS_SECRET) return true;

  const headerSecret =
    req.headers.get("x-news-cron-secret") ||
    req.headers.get("x-news-secret") ||
    "";

  if (headerSecret === FETCH_NEWS_SECRET) return true;

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return token === FETCH_NEWS_SECRET;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-news-cron-secret, x-news-secret, content-type",
      },
    });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  if (!isAuthorized(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const startedAt = new Date().toISOString();
  console.log("fetch-news started", startedAt);

  const tasks: Array<Promise<FetchResult>> = [fetchFinnhub(), fetchMarketaux()];
  tasks.push(...RSS_SOURCES.map((source) => fetchRssSource(source)));

  const settled = await Promise.allSettled(tasks);
  const allItems: NewsArticle[] = [];
  const sourceStats: Record<string, number> = {};

  for (const result of settled) {
    if (result.status !== "fulfilled") continue;

    sourceStats[result.value.sourceKey] = result.value.items.length;
    allItems.push(...result.value.items);
  }

  const deduped = dedupeBatch(allItems);
  console.log(
    "fetch-news complete",
    JSON.stringify({
      fetched: allItems.length,
      deduped: deduped.length,
      sourceStats,
    }),
  );

  if (deduped.length === 0) {
    return jsonResponse({
      inserted: 0,
      fetched: 0,
      deduped: 0,
      sourceStats,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
  }

  let inserted = 0;
  for (let offset = 0; offset < deduped.length; offset += MAX_INSERT_CHUNK) {
    const chunk = deduped.slice(offset, offset + MAX_INSERT_CHUNK);

    const { error, count } = await supabase
      .from("news_articles")
      .upsert(chunk, {
        onConflict: "original_url",
        ignoreDuplicates: true,
        count: "exact",
      });

    if (error) {
      console.error("supabase upsert error", error);
      return jsonResponse(
        {
          error: error.message,
          inserted,
          fetched: allItems.length,
          deduped: deduped.length,
          sourceStats,
        },
        500,
      );
    }

    inserted += count ?? 0;
  }

  return jsonResponse({
    inserted,
    fetched: allItems.length,
    deduped: deduped.length,
    sourceStats,
    startedAt,
    finishedAt: new Date().toISOString(),
  });
});
