import type { NewsArticleRow } from "@/lib/supabase/types";

const SOURCE_PRIORITY = [
  "Reuters",
  "CNBC",
  "FinancialJuice",
  "White House",
  "SEC",
  "Yahoo Finance",
  "Finnhub",
  "Marketaux",
  "Federal Reserve",
] as const;

/**
 * Build top source tabs in a predictable order like SaveTicker-style filters.
 */
export function buildSourceFilters(rows: NewsArticleRow[]): string[] {
  const discovered = new Set(rows.map((row) => row.source).filter(Boolean));

  // Keep a stable top tab order, even before every source has data.
  const ordered = [...SOURCE_PRIORITY];
  const extras = Array.from(discovered)
    .filter((source) => !SOURCE_PRIORITY.includes(source as (typeof SOURCE_PRIORITY)[number]))
    .sort((a, b) => a.localeCompare(b));

  return ["All", ...ordered, ...extras];
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

  if (absSeconds < 60) return rtf.format(deltaSeconds, "second");
  if (absSeconds < 3600) return rtf.format(Math.round(deltaSeconds / 60), "minute");
  if (absSeconds < 86400) return rtf.format(Math.round(deltaSeconds / 3600), "hour");
  if (absSeconds < 86400 * 7) return rtf.format(Math.round(deltaSeconds / 86400), "day");

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/**
 * Dedupe in UI by canonical URL while preserving descending publish order.
 */
export function dedupeAndSortNews(rows: NewsArticleRow[]): NewsArticleRow[] {
  const sortTime = (row: NewsArticleRow) => {
    const fetched = new Date(row.fetched_at).getTime();
    if (!Number.isNaN(fetched)) return fetched;

    const published = new Date(row.published_at).getTime();
    return Number.isNaN(published) ? 0 : published;
  };

  const seen = new Set<string>();
  const unique = rows.filter((row) => {
    if (!row.original_url || seen.has(row.original_url)) return false;
    seen.add(row.original_url);
    return true;
  });

  unique.sort(
    (a, b) => sortTime(b) - sortTime(a) || new Date(b.published_at).getTime() - new Date(a.published_at).getTime() || b.id - a.id,
  );

  return unique;
}
