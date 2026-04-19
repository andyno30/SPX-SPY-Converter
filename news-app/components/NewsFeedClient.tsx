"use client";

import { useEffect, useMemo, useState } from "react";

import { dedupeAndSortNews, NEWS_SOURCES } from "@/lib/news";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import type { NewsArticleRow } from "@/lib/supabase/types";

import { NewsCard } from "@/components/NewsCard";
import { SourcePills } from "@/components/SourcePills";

interface NewsFeedClientProps {
  initialRows: NewsArticleRow[];
  sourceFilters: string[];
}

const MAX_CLIENT_ROWS = 500;
const CATCH_UP_PER_SOURCE_LIMIT = 80;
const CATCH_UP_INTERVAL_MS = 3 * 60 * 1000;
const NEWS_SELECT = "id,title,summary,original_url,source,source_type,published_at,tickers,fetched_at";
const MIN_PUBLISHED_AT = "2020-01-01T00:00:00Z";

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
  const [rows, setRows] = useState<NewsArticleRow[]>(() =>
    dedupeAndSortNews(initialRows).filter((row) =>
      NEWS_SOURCES.includes(row.source as (typeof NEWS_SOURCES)[number]),
    ),
  );
  const [activeSource, setActiveSource] = useState<string>(sourceFilters[0] ?? "All");
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();
    let cancelled = false;

    const mergeRows = (incomingRows: NewsArticleRow[]) => {
      setRows((prev) =>
        dedupeAndSortNews([...incomingRows, ...prev])
          .filter((row) => NEWS_SOURCES.includes(row.source as (typeof NEWS_SOURCES)[number]))
          .slice(0, MAX_CLIENT_ROWS),
      );
    };

    const catchUpFromDatabase = async () => {
      const perSourceResults = await Promise.all(
        NEWS_SOURCES.map((source) =>
          supabase
            .from("news_articles")
            .select(NEWS_SELECT)
            .eq("source", source)
            .gte("published_at", MIN_PUBLISHED_AT)
            .order("published_at", { ascending: false })
            .order("fetched_at", { ascending: false })
            .limit(CATCH_UP_PER_SOURCE_LIMIT),
        ),
      );

      if (cancelled) return;

      const mergedRows: NewsArticleRow[] = [];
      perSourceResults.forEach(({ data, error }, index) => {
        if (error) {
          console.error(`Failed to catch up source ${NEWS_SOURCES[index]}`, error);
          return;
        }

        if (data?.length) {
          mergedRows.push(...(data as NewsArticleRow[]));
        }
      });

      if (mergedRows.length === 0) return;
      mergeRows(mergedRows);
    };

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

          mergeRows([incoming]);
        },
      )
      .subscribe((status) => {
        setIsLive(status === "SUBSCRIBED");
        // When websocket reconnects after sleep/network drops, fetch missed rows.
        if (status === "SUBSCRIBED") {
          void catchUpFromDatabase();
        }
      });

    const intervalId = window.setInterval(() => {
      void catchUpFromDatabase();
    }, CATCH_UP_INTERVAL_MS);

    const onFocus = () => {
      void catchUpFromDatabase();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void catchUpFromDatabase();
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Initial catch-up after mount to avoid stale overnight tab snapshots.
    void catchUpFromDatabase();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
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
