# News Page Implementation Summary

## Architecture

- Existing static website remains unchanged in repo root.
- New isolated Next.js app lives at `news-app/` and serves `/news`.
- Supabase edge function (`supabase/functions/fetch-news/index.ts`) ingests news into `public.news_articles`.
- Supabase Realtime pushes inserts to the browser feed without refresh.

## Core Files

- SQL setup: `supabase/sql/news_articles_setup.sql`
- SQL fetch scheduler: `supabase/sql/news_fetch_scheduler.sql`
- Edge fetcher: `supabase/functions/fetch-news/index.ts`
- News route: `news-app/app/news/page.tsx`
- Realtime feed: `news-app/components/NewsFeedClient.tsx`
- News card: `news-app/components/NewsCard.tsx`
- Source pills: `news-app/components/SourcePills.tsx`

## Notes

- Stores only lightweight metadata (`title`, `summary`, URL, source, timestamps, tickers).
- URL dedupe is enforced both at DB level (`UNIQUE original_url`) and in edge function canonicalization.
- Daily trim + vacuum keeps the table near free-tier constraints. The trim
  function deletes only from `public.news_articles`; it does not delete
  profiles or auth users, and it is a scheduled retention job rather than a
  Supabase "out of memory" purge.
- Clicking a news card opens the stored summary in an on-site modal. The card
  no longer navigates users directly to the original article URL.
- Source filtering uses `All`, `Reuters`, `CNBC`, `Yahoo Finance`, `SEC`, and `Federal Reserve`.

## SEC publication date validation

The importer rejects SEC articles with missing, invalid, pre-2020, or more than
15-minute future publication timestamps. It also checks the year in SEC release
numbers so archived articles cannot pass with incorrectly updated feed dates.

On September 11, 2026, three archived releases (97-114, 97-99, and 99-110) were
found with 2026 timestamps. `supabase/sql/news_sec_date_repair.sql` restores their
verified 1997/1999 publication years without deleting the records. The existing
2020 cutoff then excludes them from the live news page. Apply this repair once
alongside the updated `fetch-news` function; the SQL is safe to rerun.

Run the parser regression checks with `node --test scripts/test_news_dates.cjs`
after installing the existing `news-app` dependencies. These checks stub network
and database dependencies and exercise the actual RSS parser.
