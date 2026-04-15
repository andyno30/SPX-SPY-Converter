# SpyConverter News App (Next.js)

This folder is an isolated Next.js app for the `/news` experience.
Your existing static GitHub Pages site files remain untouched.

## 1) Install & run locally

```bash
cd news-app
npm install
cat > .env.local <<'ENV'
NEXT_PUBLIC_SUPABASE_URL=https://isvzhpqrmjtqnqyyidxr.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_f5EYFGZ8NNT7dczGGyBnCA_T1uOvDaf
ENV
npm run dev
```

Open: `http://localhost:3000/news`

## 2) Environment variables

Set these in Vercel (Project Settings -> Environment Variables):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_FETCH_NEWS_URL` (for Vercel cron bridge)
- `CRON_SECRET` (for `/api/cron/fetch-news` protection)
- `FETCH_NEWS_SECRET` (same secret expected by edge function)

## 3) Supabase SQL setup

Run these SQL scripts in Supabase SQL Editor:

1. `supabase/sql/news_articles_setup.sql`
2. `supabase/sql/news_fetch_scheduler.sql` (optional if using Supabase cron for fetch)

## 4) Deploy edge function

From repo root:

```bash
supabase functions deploy fetch-news --no-verify-jwt
```

Set required secrets:

```bash
supabase secrets set PROJECT_URL=https://YOUR_PROJECT_REF.supabase.co
supabase secrets set SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
supabase secrets set FINNHUB_API_KEY=YOUR_FINNHUB_KEY
supabase secrets set MARKETAUX_API_KEY=YOUR_MARKETAUX_KEY
supabase secrets set FETCH_NEWS_SECRET=YOUR_FETCH_NEWS_SECRET
# Optional feeds
supabase secrets set FINANCIALJUICE_RSS_URL=https://example.com/rss
supabase secrets set SAVETICKER_NEWS_RSS_URL=https://example.com/rss
```

## 5) Scheduler options

### Option A: Supabase Cron (recommended)

Use `supabase/sql/news_fetch_scheduler.sql` to call the edge function every 15 minutes.

### Option B: Vercel Cron

`news-app/vercel.json` already defines a `*/15 * * * *` cron to hit `/api/cron/fetch-news`.

For this mode:

1. Set `CRON_SECRET` in Vercel.
2. Set `SUPABASE_FETCH_NEWS_URL` to your edge function URL.
3. Ensure `FETCH_NEWS_SECRET` matches the edge function secret.

## 6) Deploy on Vercel

Create a Vercel project using `news-app` as the root directory.

- If you use a subdomain, map `news.spyconverter.com` to this Vercel project.
- If you later front it behind `spyconverter.com/news`, use a reverse proxy or domain routing rule.
