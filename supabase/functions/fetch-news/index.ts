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

// Optional endpoint secrets for scheduler calls.
const FETCH_NEWS_SECRET = Deno.env.get("FETCH_NEWS_SECRET") ?? "";

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
  baseUrl?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TITLE_LEN = 300;
const MAX_SUMMARY_LEN = 500;
const MAX_TICKERS_PER_ARTICLE = 8;
const MAX_INSERT_CHUNK = 500;
const FEDERAL_RESERVE_FALLBACK_URL = "https://www.federalreserve.gov/newsevents.htm";
const SEC_PRESS_RELEASES_URL =
  "https://www.sec.gov/news/pressreleases?items_per_page=100&month=All&page=0&year=All";
const WHITE_HOUSE_RELEASES_URL = "https://www.whitehouse.gov/releases/";
const SEC_MIN_ALLOWED_PUBLISHED_AT_MS = Date.UTC(2020, 0, 1);

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
  "yields",
  "futures",
  "stock futures",
  "index futures",
  "premarket",
  "pre-market",
  "after hours",
  "after-hours",
  "risk-on",
  "risk-off",
  "bond market",
  "global markets",
  "international markets",
  "european markets",
  "asian markets",
  "nikkei",
  "hang seng",
  "dax",
  "ftse",
  "stoxx",
  "currency market",
  "forex",
  "fx",
  "dollar index",
  "gold",
  "crude",
  "brent",
  "wti",
  "commodities",
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
  "tariffs",
  "white house",
  "administration",
  "policy",
  "economy",
  "economic",
  "jobs",
  "job growth",
  "employment",
  "manufacturing",
  "trade policy",
  "tax",
  "budget",
  "deficit",
  "debt ceiling",
  "debt",
  "executive order",
  "industrial policy",
  "consumer spending",
  "retail sales",
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
  "SEC",
  "Yahoo Finance",
  "Federal Reserve",
  "White House",
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
    sourceKey: "yahoo_finance_news",
    url: "https://finance.yahoo.com/news/rss",
    source: "Yahoo Finance",
    sourceType: "aggregator",
  },
  {
    sourceKey: "federal_reserve_press",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    source: "Federal Reserve",
    sourceType: "regulator",
    baseUrl: "https://www.federalreserve.gov",
  },
];

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

function normalizeDateLabel(raw: string): string {
  return raw
    .replace(/\u00a0/g, " ")
    .replace(/\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\./gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.trim() ?? "";
}

function resolveMaybeRelativeUrl(rawUrl: string, baseUrl?: string): string {
  const cleaned = stripHtml(stripCDATA(rawUrl)).trim();
  if (!cleaned) return "";

  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  if (!baseUrl) return cleaned;

  try {
    return new URL(cleaned, baseUrl).toString();
  } catch {
    return cleaned;
  }
}

function extractLink(block: string, source: string, baseUrl?: string): string {
  const alternateHrefMatch =
    block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*>/i) ||
    block.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["'][^>]*>/i);
  if (alternateHrefMatch?.[1]) return resolveMaybeRelativeUrl(alternateHrefMatch[1], baseUrl);

  const htmlTypeHrefMatch =
    block.match(/<link[^>]*type=["']text\/html["'][^>]*href=["']([^"']+)["'][^>]*>/i) ||
    block.match(/<link[^>]*href=["']([^"']+)["'][^>]*type=["']text\/html["'][^>]*>/i);
  if (htmlTypeHrefMatch?.[1]) return resolveMaybeRelativeUrl(htmlTypeHrefMatch[1], baseUrl);

  const hrefMatches = Array.from(
    block.matchAll(/<link[^>]*href=["']([^"']+)["'][^>]*>/gi),
    (match) => resolveMaybeRelativeUrl(match[1], baseUrl),
  );

  if (source === "Federal Reserve") {
    const federalArticleUrl = hrefMatches.find((url) =>
      /federalreserve\.gov\/newsevents\/pressreleases\//i.test(url),
    );
    if (federalArticleUrl) return federalArticleUrl;
  }

  const firstLikelyArticleUrl = hrefMatches.find(
    (url) => !/\/feeds\//i.test(url) && !/\.xml($|[?#])/i.test(url),
  );
  if (firstLikelyArticleUrl) return firstLikelyArticleUrl;

  if (hrefMatches[0]) return hrefMatches[0];

  const directLink = extractTag(block, "link");
  if (directLink) return resolveMaybeRelativeUrl(directLink, baseUrl);

  const guid = extractTag(block, "guid");
  if (guid) return resolveMaybeRelativeUrl(guid, baseUrl);

  const id = extractTag(block, "id");
  return id ? resolveMaybeRelativeUrl(id, baseUrl) : "";
}

function buildStableRef(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function makeFederalReserveFallbackUrl(title: string, publishedAt: string): string {
  const ref = buildStableRef(`${title}|${publishedAt}`);
  return `${FEDERAL_RESERVE_FALLBACK_URL}?ref=${ref}`;
}

function isFederalReserveArticleUrl(url: string): boolean {
  return /https?:\/\/(?:www\.)?federalreserve\.gov\/newsevents\/pressreleases\/[a-z]+\d{8}[a-z]?\.htm(?:[?#].*)?$/i.test(
    url,
  );
}

function normalizeFederalReserveUrl(rawUrl: string, title: string, publishedAt: string): string {
  const canonical = canonicalizeUrl(stripHtml(stripCDATA(rawUrl)));
  if (canonical && isFederalReserveArticleUrl(canonical)) {
    return canonical;
  }

  // Keep other official Fed newsevents URLs if provided.
  if (canonical && /https?:\/\/(?:www\.)?federalreserve\.gov\/newsevents/i.test(canonical)) {
    return canonical;
  }

  return makeFederalReserveFallbackUrl(title, publishedAt);
}

async function federalReserveUrlReturns404(url: string): Promise<boolean> {
  const candidate = canonicalizeUrl(url);
  if (!candidate) return true;
  if (/\/newsevents\.htm(?:[?#].*)?$/i.test(candidate)) return false;

  try {
    const headResponse = await fetch(candidate, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      headers: {
        "User-Agent": "SpyConverterNewsBot/1.0 (+https://spyconverter.com)",
      },
    });

    if (headResponse.status === 404 || headResponse.status === 410) return true;
    if (headResponse.ok || headResponse.redirected) return false;

    // Some endpoints do not support HEAD; validate with GET before deciding.
    if (![405, 501].includes(headResponse.status)) return false;
  } catch {
    // Network/transient failures should not force fallback.
    return false;
  }

  try {
    const getResponse = await fetch(candidate, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      headers: {
        "User-Agent": "SpyConverterNewsBot/1.0 (+https://spyconverter.com)",
      },
    });

    return getResponse.status === 404 || getResponse.status === 410;
  } catch {
    return false;
  }
}

async function applyFederalReserveFallbackOn404(articles: NewsArticle[]): Promise<NewsArticle[]> {
  const updates = await Promise.all(
    articles.map(async (article) => {
      if (article.source !== "Federal Reserve") return article;

      const shouldFallback = await federalReserveUrlReturns404(article.original_url);
      if (!shouldFallback) return article;

      return {
        ...article,
        original_url: makeFederalReserveFallbackUrl(article.title, article.published_at),
      };
    }),
  );

  return updates;
}

function parseDate(rawDate: string): string {
  if (!rawDate) return new Date().toISOString();
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function parseFederalReserveDateFromUrl(url: string): string | null {
  const match = url.match(
    /\/newsevents\/pressreleases\/[a-z]+(\d{4})(\d{2})(\d{2})[a-z]?\.htm/i,
  );
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) return null;

  // Use noon UTC to avoid date-shift edge cases across timezones.
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).toISOString();
}

function resolvePublishedAt(source: string, rawDate: string, originalUrl: string): string {
  if (source === "Federal Reserve") {
    const inferredFromUrl = parseFederalReserveDateFromUrl(originalUrl);
    if (inferredFromUrl) return inferredFromUrl;
  }

  return parseDate(normalizeDateLabel(rawDate));
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
  const source = (input.source ?? "").trim();
  const source_type = input.source_type;
  const originalUrlForDate = canonicalizeUrl(stripHtml(stripCDATA(input.original_url ?? "")));
  const published_at = resolvePublishedAt(source, input.published_at ?? "", originalUrlForDate);
  const original_url =
    source === "Federal Reserve"
      ? normalizeFederalReserveUrl(input.original_url ?? "", title, published_at)
      : originalUrlForDate;

  if (!title || !original_url || !source || !source_type) return null;
  if (!SOURCE_ALLOWLIST.has(source)) return null;
  if (source === "Federal Reserve" && !/federalreserve\.gov\/newsevents/i.test(original_url)) {
    return null;
  }
  if (source === "SEC") {
    const secPublishedAt = new Date(published_at).getTime();
    if (Number.isNaN(secPublishedAt) || secPublishedAt < SEC_MIN_ALLOWED_PUBLISHED_AT_MS) {
      return null;
    }
  }

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

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    headers: {
      "User-Agent": "SpyConverterNewsBot/1.0 (+https://spyconverter.com)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return await response.text();
}

function parseSecPressReleasesFromHtml(html: string): NewsArticle[] {
  const rowBlocks = html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];

  return rowBlocks
    .map((row) => {
      const linkMatch = row.match(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      const dateMatch = row.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
      if (!linkMatch?.[1] || !linkMatch?.[2] || !dateMatch?.[1]) return null;

      const originalUrl = resolveMaybeRelativeUrl(linkMatch[1], "https://www.sec.gov");
      if (!/sec\.gov\/news(?:room)?\/press-releases\//i.test(originalUrl)) return null;

      const title = stripHtml(linkMatch[2]).slice(0, MAX_TITLE_LEN);
      const publishedAt = parseDate(normalizeDateLabel(stripHtml(dateMatch[1])));

      return normalizeArticle({
        title,
        summary: "",
        original_url: originalUrl,
        source: "SEC",
        source_type: "regulator",
        published_at: publishedAt,
        tickers: extractTickers(title),
      });
    })
    .filter((item: NewsArticle | null): item is NewsArticle => item !== null);
}

async function fetchSecPressReleases(): Promise<FetchResult> {
  try {
    const html = await fetchHtml(SEC_PRESS_RELEASES_URL);
    const items = parseSecPressReleasesFromHtml(html);
    if (items.length > 0) {
      return { sourceKey: "sec_press_releases_html", items };
    }
  } catch (error) {
    console.error("sec html fetch failed", error);
  }

  // Fallback in case SEC updates newsroom page markup.
  return await fetchRssSource({
    sourceKey: "sec_press_releases_rss",
    url: "https://www.sec.gov/news/pressreleases.rss",
    source: "SEC",
    sourceType: "regulator",
    baseUrl: "https://www.sec.gov",
  });
}

function parseWhiteHouseReleasesFromHtml(html: string): NewsArticle[] {
  const articleBlocks = html.match(/<article\b[\s\S]*?<\/article>/gi) ?? [];

  return articleBlocks
    .map((block) => {
      const linkMatch = block.match(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch?.[1] || !linkMatch?.[2]) return null;

      const originalUrl = resolveMaybeRelativeUrl(linkMatch[1], "https://www.whitehouse.gov");
      if (!/whitehouse\.gov\/releases\//i.test(originalUrl)) return null;

      const title = stripHtml(linkMatch[2]).slice(0, MAX_TITLE_LEN);

      const dateFromDatetime =
        block.match(/<time[^>]*datetime=["']([^"']+)["'][^>]*>/i)?.[1] ?? "";
      const dateFromText = stripHtml(block.match(/<time[^>]*>([\s\S]*?)<\/time>/i)?.[1] ?? "");
      const publishedAt = parseDate(normalizeDateLabel(dateFromDatetime || dateFromText));

      return normalizeArticle({
        title,
        summary: "",
        original_url: originalUrl,
        source: "White House",
        source_type: "government",
        published_at: publishedAt,
        tickers: extractTickers(title),
      });
    })
    .filter((item: NewsArticle | null): item is NewsArticle => item !== null);
}

async function fetchWhiteHouseReleases(): Promise<FetchResult> {
  try {
    const html = await fetchHtml(WHITE_HOUSE_RELEASES_URL);
    const items = parseWhiteHouseReleasesFromHtml(html);
    if (items.length > 0) {
      return { sourceKey: "white_house_releases_html", items };
    }
  } catch (error) {
    console.error("white house html fetch failed", error);
  }

  return await fetchRssSource({
    sourceKey: "white_house_releases_rss",
    url: "https://www.whitehouse.gov/releases/feed/",
    source: "White House",
    sourceType: "government",
    baseUrl: "https://www.whitehouse.gov",
  });
}

function parseRssEntries(
  xml: string,
  source: string,
  sourceType: SourceType,
  baseUrl?: string,
): NewsArticle[] {
  const itemBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const entryBlocks = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  const blocks = [...itemBlocks, ...entryBlocks];

  return blocks
    .map((block) => {
      const title = extractTag(block, "title");
      const description =
        extractTag(block, "description") ||
        extractTag(block, "summary") ||
        extractTag(block, "frb:summary") ||
        extractTag(block, "subtitle") ||
        extractTag(block, "content") ||
        extractTag(block, "content:encoded");
      const link = extractLink(block, source, baseUrl);
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
    const items = parseRssEntries(
      xml,
      config.source,
      config.sourceType,
      config.baseUrl ?? config.url,
    );
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

  const tasks: Array<Promise<FetchResult>> = [
    fetchSecPressReleases(),
    fetchWhiteHouseReleases(),
    ...RSS_SOURCES.map((source) => fetchRssSource(source)),
  ];

  const settled = await Promise.allSettled(tasks);
  const allItems: NewsArticle[] = [];
  const sourceStats: Record<string, number> = {};

  for (const result of settled) {
    if (result.status !== "fulfilled") continue;

    sourceStats[result.value.sourceKey] = result.value.items.length;
    allItems.push(...result.value.items);
  }

  const deduped = dedupeBatch(allItems);
  const withFedFallbacks = await applyFederalReserveFallbackOn404(deduped);
  const finalArticles = dedupeBatch(withFedFallbacks);
  console.log(
    "fetch-news complete",
    JSON.stringify({
      fetched: allItems.length,
      deduped: finalArticles.length,
      sourceStats,
    }),
  );

  if (finalArticles.length === 0) {
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
  for (let offset = 0; offset < finalArticles.length; offset += MAX_INSERT_CHUNK) {
    const chunk = finalArticles.slice(offset, offset + MAX_INSERT_CHUNK);

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
          deduped: finalArticles.length,
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
    deduped: finalArticles.length,
    sourceStats,
    startedAt,
    finishedAt: new Date().toISOString(),
  });
});
