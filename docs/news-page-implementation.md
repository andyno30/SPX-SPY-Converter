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
- Daily trim + vacuum keeps the table near free-tier constraints.
- Source filtering is SaveTicker-style pill tabs and supports realtime inserts at top.
