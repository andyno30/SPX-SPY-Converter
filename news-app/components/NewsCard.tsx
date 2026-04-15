import { formatNewsTime, getArticleHref } from "@/lib/news";
import type { NewsArticleRow } from "@/lib/supabase/types";

interface NewsCardProps {
  article: NewsArticleRow;
}

/**
 * SaveTicker-style clean card with headline, summary, source badge, and timestamp.
 */
export function NewsCard({ article }: NewsCardProps) {
  const href = getArticleHref(article);

  return (
    <article className="group rounded-2xl border border-slate-200 bg-white shadow-card transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="block p-5 sm:p-6"
      >
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="rounded-full bg-slate-900 px-2.5 py-1 font-semibold tracking-wide text-white">
            {article.source}
          </span>
          <time
            suppressHydrationWarning
            className="ml-auto whitespace-nowrap font-medium text-slate-500"
          >
            {formatNewsTime(article.published_at)}
          </time>
        </div>

        <h2 className="text-lg font-extrabold leading-tight text-slate-900 transition-colors group-hover:text-slate-700 sm:text-xl">
          {article.title}
        </h2>

        {article.summary ? (
          <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-[0.95rem]">
            {article.summary}
          </p>
        ) : null}

        {article.tickers.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {article.tickers.slice(0, 6).map((ticker) => (
              <span
                key={`${article.id}-${ticker}`}
                className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold tracking-wide text-slate-700"
              >
                {ticker}
              </span>
            ))}
          </div>
        ) : null}
      </a>
    </article>
  );
}
