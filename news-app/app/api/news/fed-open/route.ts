import { NextResponse } from "next/server";

const FED_NEWS_FALLBACK_URL = "https://www.federalreserve.gov/newsevents.htm";
const FEDERAL_RESERVE_HOST_RE = /(^|\.)federalreserve\.gov$/i;
const FEDERAL_RESERVE_PATH_RE = /^\/newsevents\/pressreleases\/[a-z]+\d{8}[a-z]?\.htm$/i;
const DEFAULT_TIMEOUT_MS = 8000;

function isSupportedFedTarget(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (!FEDERAL_RESERVE_HOST_RE.test(url.hostname)) return null;
    if (!FEDERAL_RESERVE_PATH_RE.test(url.pathname)) return null;
    return url;
  } catch {
    return null;
  }
}

function isMissingPageHtml(html: string): boolean {
  const normalized = html.toLowerCase();
  return (
    normalized.includes("404") ||
    normalized.includes("page not found") ||
    normalized.includes("requested page could not be found") ||
    normalized.includes("we can't seem to find")
  );
}

async function shouldFallback(url: string): Promise<boolean> {
  const target = isSupportedFedTarget(url);
  if (!target) return true;

  try {
    const response = await fetch(target.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "SpyConverterNewsBot/1.0 (+https://spyconverter.com)",
      },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) return true;

    const html = await response.text();
    return isMissingPageHtml(html);
  } catch {
    return true;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawTarget = url.searchParams.get("url") ?? "";

  if (!rawTarget) {
    return NextResponse.redirect(FED_NEWS_FALLBACK_URL, 307);
  }

  const fallback = await shouldFallback(rawTarget);
  return NextResponse.redirect(fallback ? FED_NEWS_FALLBACK_URL : rawTarget, 307);
}

