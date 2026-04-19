import type { Metadata } from "next";

import { LegacySiteFooter, LegacySiteHeader } from "@/components/LegacySiteChrome";
import { NewsAds } from "@/components/NewsAds";
import { NewsFeedClient } from "@/components/NewsFeedClient";
import { buildSourceFilters, dedupeAndSortNews, NEWS_SOURCES } from "@/lib/news";
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

const NEWS_SELECT =
  "id,title,summary,original_url,source,source_type,published_at,tickers,fetched_at";
const MIN_PUBLISHED_AT = "2020-01-01T00:00:00Z";
const INITIAL_PER_SOURCE_LIMIT = 90;

async function loadInitialNews(): Promise<NewsArticleRow[]> {
  const supabase = createServerSupabaseClient();
  const perSourceResults = await Promise.all(
    NEWS_SOURCES.map((source) =>
      supabase
        .from("news_articles")
        .select(NEWS_SELECT)
        .eq("source", source)
        .gte("published_at", MIN_PUBLISHED_AT)
        .order("published_at", { ascending: false })
        .order("fetched_at", { ascending: false })
        .limit(INITIAL_PER_SOURCE_LIMIT),
    ),
  );

  const mergedRows: NewsArticleRow[] = [];
  perSourceResults.forEach(({ data, error }, index) => {
    if (error) {
      console.error(`Failed to load news for source ${NEWS_SOURCES[index]}`, error);
      return;
    }

    if (data?.length) {
      mergedRows.push(...(data as NewsArticleRow[]));
    }
  });

  return dedupeAndSortNews(mergedRows);
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
    <>
      <LegacySiteHeader />

      <main className="mx-auto max-w-[800px] px-4 pb-36 pt-6 sm:px-6 lg:px-0">
        <header className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">SpyConverter</p>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
            U.S. Market News
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
            Headlines from CNBC, Yahoo Finance, SEC, Federal Reserve, and
            White House releases.
          </p>
        </header>

        <NewsFeedClient initialRows={initialRows} sourceFilters={sourceFilters} />
        <NewsAds />

        <script
          type="application/ld+json"
          // JSON-LD for better crawlability of this feed page.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </main>

      <LegacySiteFooter />
    </>
  );
}
