-- ============================================================================
-- SpyConverter News Setup (idempotent + free-tier safe)
-- Run in Supabase SQL Editor
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 1) Table --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.news_articles (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  original_url TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  source_type TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  tickers TEXT[] NOT NULL DEFAULT '{}',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) Indexes ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_news_published_at
  ON public.news_articles (published_at DESC);

CREATE INDEX IF NOT EXISTS idx_news_source_type_published_at
  ON public.news_articles (source_type, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_news_source_published_at
  ON public.news_articles (source, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_news_tickers_gin
  ON public.news_articles USING GIN (tickers);

-- 3) RLS ----------------------------------------------------------------------
ALTER TABLE public.news_articles ENABLE ROW LEVEL SECURITY;

-- Drop any previous policy naming variants to keep reruns safe.
DROP POLICY IF EXISTS "Anyone can read news articles" ON public.news_articles;
DROP POLICY IF EXISTS "Public read news" ON public.news_articles;
DROP POLICY IF EXISTS "news_public_read" ON public.news_articles;
DROP POLICY IF EXISTS "Service role can manage news" ON public.news_articles;
DROP POLICY IF EXISTS "Service role full access" ON public.news_articles;
DROP POLICY IF EXISTS "news_service_role_all" ON public.news_articles;

CREATE POLICY "news_public_read"
  ON public.news_articles
  FOR SELECT
  USING (true);

CREATE POLICY "news_service_role_all"
  ON public.news_articles
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 4) Realtime publication -----------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'news_articles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.news_articles;
  END IF;
END
$$;

-- 5) Cleanup function: keep only latest 20,000 rows --------------------------
CREATE OR REPLACE FUNCTION public.news_trim_to_latest_20000()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.news_articles
  WHERE id IN (
    SELECT id
    FROM public.news_articles
    ORDER BY published_at DESC, id DESC
    OFFSET 20000
  );
END;
$$;

-- 6) Cron jobs ----------------------------------------------------------------
-- Remove prior jobs with the same names so scheduling is deterministic.
DO $$
DECLARE
  v_job RECORD;
BEGIN
  FOR v_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN ('news_trim_20000', 'news_vacuum_analyze')
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;
END
$$;

-- Daily trim at 03:00 UTC
SELECT cron.schedule(
  'news_trim_20000',
  '0 3 * * *',
  $$SELECT public.news_trim_to_latest_20000();$$
);

-- Daily vacuum/analyze at 03:10 UTC
SELECT cron.schedule(
  'news_vacuum_analyze',
  '10 3 * * *',
  $$VACUUM ANALYZE public.news_articles;$$
);

-- Optional checks:
-- SELECT * FROM cron.job WHERE jobname LIKE 'news_%' ORDER BY jobname;
-- SELECT reltuples::BIGINT AS approx_rows FROM pg_class WHERE relname = 'news_articles';
