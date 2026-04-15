"use client";

import { useEffect, useMemo, useState } from "react";

import { dedupeAndSortNews } from "@/lib/news";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import type { NewsArticleRow } from "@/lib/supabase/types";

import { NewsCard } from "@/components/NewsCard";
import { SourcePills } from "@/components/SourcePills";

interface NewsFeedClientProps {
  initialRows: NewsArticleRow[];
  sourceFilters: string[];
}

function normalizeRealtimeRow(payloadRow: Partial<NewsArticleRow>): NewsArticleRow | null {
  if (
    !payloadRow.id ||
    !payloadRow.title ||
    !payloadRow.original_url ||
    !payloadRow.source ||
    !payloadRow.source_type ||
    !payloadRow.published_at
  ) {
    return null;
  }

  return {
    id: Number(payloadRow.id),
    title: String(payloadRow.title),
    summary: typeof payloadRow.summary === "string" ? payloadRow.summary : null,
    original_url: String(payloadRow.original_url),
    source: String(payloadRow.source),
    source_type: String(payloadRow.source_type),
    published_at: String(payloadRow.published_at),
    tickers: Array.isArray(payloadRow.tickers)
      ? payloadRow.tickers.map((ticker) => String(ticker).toUpperCase())
      : [],
    fetched_at:
      typeof payloadRow.fetched_at === "string"
        ? payloadRow.fetched_at
        : new Date().toISOString(),
  };
}

/**
 * Client feed for source filtering + Supabase realtime inserts.
 */
export function NewsFeedClient({ initialRows, sourceFilters }: NewsFeedClientProps) {
  const [rows, setRows] = useState<NewsArticleRow[]>(() => dedupeAndSortNews(initialRows));
  const [activeSource, setActiveSource] = useState<string>(sourceFilters[0] ?? "All");
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();

    const channel = supabase
      .channel("news_articles_inserts")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "news_articles",
        },
        (payload) => {
          const incoming = normalizeRealtimeRow(payload.new as Partial<NewsArticleRow>);
          if (!incoming) return;

          setRows((prev) => {
            const merged = [incoming, ...prev];
            return dedupeAndSortNews(merged).slice(0, 500);
          });
        },
      )
      .subscribe((status) => {
        setIsLive(status === "SUBSCRIBED");
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const counts = useMemo(() => {
    const map: Record<string, number> = { All: rows.length };
    for (const row of rows) {
      map[row.source] = (map[row.source] ?? 0) + 1;
    }
    return map;
  }, [rows]);

  const visibleRows = useMemo(() => {
    if (activeSource === "All") return rows;
    return rows.filter((row) => row.source === activeSource);
  }, [rows, activeSource]);

  return (
    <section className="space-y-4">
      <div className="sticky top-0 z-10 rounded-2xl border border-slate-200 bg-canvas/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-canvas/75 sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-4">
          <p className="text-sm font-semibold text-slate-700">
            Live U.S. market feed
            <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500">
              <span
                className={[
                  "inline-block h-2 w-2 rounded-full",
                  isLive ? "bg-emerald-500" : "bg-slate-400",
                ].join(" ")}
                aria-hidden="true"
              />
              {isLive ? "Realtime on" : "Connecting"}
            </span>
          </p>
          <p className="text-xs text-slate-500">{counts[activeSource] ?? 0} headlines</p>
        </div>

        <SourcePills
          sources={sourceFilters}
          activeSource={activeSource}
          counts={counts}
          onChange={setActiveSource}
        />
      </div>

      <div className="space-y-3">
        {visibleRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            No stories found for this source yet.
          </div>
        ) : (
          visibleRows.map((article) => <NewsCard key={article.id} article={article} />)
        )}
      </div>
    </section>
  );
}
