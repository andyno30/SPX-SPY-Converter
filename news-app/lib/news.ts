import type { NewsArticleRow } from "@/lib/supabase/types";

export const NEWS_SOURCES = [
  "Reuters",
  "CNBC",
  "Yahoo Finance",
  "SEC",
  "Federal Reserve",
  "White House",
] as const;

/**
 * Build top source tabs in a predictable order like SaveTicker-style filters.
 */
export function buildSourceFilters(rows: NewsArticleRow[]): string[] {
  void rows;
  return ["All", ...NEWS_SOURCES];
}

/**
 * Human-readable timestamp for card metadata.
 */
export function formatNewsTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "Just now";

  const now = Date.now();
  const deltaMs = date.getTime() - now;
  const deltaSeconds = Math.round(deltaMs / 1000);

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const absSeconds = Math.abs(deltaSeconds);

  // Avoid second-level labels to reduce hydration mismatch risk between SSR/CSR.
  if (absSeconds < 60) return "Just now";
  if (absSeconds < 3600) return rtf.format(Math.round(deltaSeconds / 60), "minute");
  if (absSeconds < 86400) return rtf.format(Math.round(deltaSeconds / 3600), "hour");
  if (absSeconds < 86400 * 7) return rtf.format(Math.round(deltaSeconds / 86400), "day");

  // Build from parts so output stays stable across runtimes (Safari vs Node ICU).
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const byType = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const month = byType("month");
  const day = byType("day");
  const hour = byType("hour");
  const minute = byType("minute");
  const dayPeriod = byType("dayPeriod");

  if (!month || !day || !hour || !minute) return date.toISOString();
  return `${month} ${day}, ${hour}:${minute}${dayPeriod ? ` ${dayPeriod}` : ""}`;
}

/**
 * Dedupe in UI by canonical URL while preserving descending publish order.
 */
export function dedupeAndSortNews(rows: NewsArticleRow[]): NewsArticleRow[] {
  const publishedTime = (row: NewsArticleRow) => {
    const published = new Date(row.published_at).getTime();
    return Number.isNaN(published) ? 0 : published;
  };

  const fetchedTime = (row: NewsArticleRow) => {
    const fetched = new Date(row.fetched_at).getTime();
    return Number.isNaN(fetched) ? 0 : fetched;
  };

  const seen = new Set<string>();
  const unique = rows.filter((row) => {
    if (!row.original_url || seen.has(row.original_url)) return false;
    seen.add(row.original_url);
    return true;
  });

  unique.sort(
    (a, b) => publishedTime(b) - publishedTime(a) || fetchedTime(b) - fetchedTime(a) || b.id - a.id,
  );

  return unique;
}
