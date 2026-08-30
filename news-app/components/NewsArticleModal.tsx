"use client";

import { useEffect, useRef } from "react";

import { formatNewsTime } from "@/lib/news";
import type { NewsArticleRow } from "@/lib/supabase/types";
import { NewsEngagement } from "@/components/NewsEngagement";

interface NewsArticleModalProps {
  article: NewsArticleRow;
  onClose: () => void;
}

export function NewsArticleModal({ article, onClose }: NewsArticleModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="news-article-modal-title"
        className="flex max-h-[min(88vh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
      >
        <header className="border-b border-slate-200 px-5 pb-5 pt-5 sm:px-7 sm:pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="rounded-full bg-slate-900 px-2.5 py-1 font-semibold tracking-wide text-white">
                {article.source}
              </span>
              <time suppressHydrationWarning>{formatNewsTime(article.published_at)}</time>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Close news item"
              className="-mr-2 -mt-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-2xl leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>

          <h2
            id="news-article-modal-title"
            className="mt-4 text-2xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-3xl"
          >
            {article.title}
          </h2>
        </header>

        <div className="overflow-y-auto px-5 py-6 sm:px-7 sm:py-7">
          {article.summary ? (
            <div>
              <p className="mb-5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Article summary
              </p>
              <p className="whitespace-pre-line text-base leading-8 text-slate-700 sm:text-lg">
                {article.summary}
              </p>
            </div>
          ) : null}

          {article.tickers.length > 0 ? (
            <div className="mt-7 flex flex-wrap gap-1.5 border-t border-slate-100 pt-5">
              {article.tickers.slice(0, 6).map((ticker) => (
                <span
                  key={`${article.id}-modal-${ticker}`}
                  className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold tracking-wide text-slate-700"
                >
                  {ticker}
                </span>
              ))}
            </div>
          ) : null}

          <NewsEngagement articleId={article.id} />
        </div>

        <footer className="border-t border-slate-200 bg-slate-50 px-5 py-4 text-xs leading-relaxed text-slate-500 sm:px-7">
          {article.summary ? "This summary" : "This headline"} is provided on SpyConverter. The original source is {article.source}.
        </footer>
      </section>
    </div>
  );
}
