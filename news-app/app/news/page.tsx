import type { Metadata } from "next";

import { NewsFeedClient } from "@/components/NewsFeedClient";
import { buildSourceFilters, dedupeAndSortNews } from "@/lib/news";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { NewsArticleRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "News",
  description:
    "Live U.S. market, stock, and macro headlines with source filtering and near realtime updates.",
  alternates: {
    canonical: "/news",
  },
};

async function loadInitialNews(): Promise<NewsArticleRow[]> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("news_articles")
    .select(
      "id,title,summary,original_url,source,source_type,published_at,tickers,fetched_at",
    )
    // Sort by ingestion time so newly fetched stories remain visible after refresh.
    .order("fetched_at", { ascending: false })
    .order("published_at", { ascending: false })
    .limit(300);

  if (error) {
    console.error("Failed to load initial news", error);
    return [];
  }

  return dedupeAndSortNews((data ?? []) as NewsArticleRow[]);
}

export default async function NewsPage() {
  const initialRows = await loadInitialNews();
  const sourceFilters = buildSourceFilters(initialRows);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "SpyConverter News",
    description:
      "English-only U.S. market, stock, and macro headlines from trusted free sources.",
    inLanguage: "en-US",
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: initialRows.length,
    },
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">SpyConverter</p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
          U.S. Market News
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          English-only headlines from Reuters, CNBC, Yahoo Finance, SEC, White House, Finnhub,
          Marketaux, and other market-relevant free sources.
        </p>
      </header>

      <NewsFeedClient initialRows={initialRows} sourceFilters={sourceFilters} />

      <script
        type="application/ld+json"
        // JSON-LD for better crawlability of this feed page.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </main>
  );
}
