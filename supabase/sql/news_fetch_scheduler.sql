-- ============================================================================
-- SpyConverter News Fetch Scheduler (Supabase Cron + pg_net)
-- Run after deploying the fetch-news edge function.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Replace these placeholders before running:
--   YOUR_PROJECT_REF       -> e.g. abcdefghijklmnop
--   YOUR_FETCH_NEWS_SECRET -> same value as FETCH_NEWS_SECRET edge function secret

DO $$
DECLARE
  v_job RECORD;
BEGIN
  FOR v_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'news_fetch_every_15m'
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;
END
$$;

SELECT cron.schedule(
  'news_fetch_every_15m',
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/fetch-news',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-news-cron-secret', 'YOUR_FETCH_NEWS_SECRET'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  $$
);

-- Optional checks:
-- SELECT * FROM cron.job WHERE jobname = 'news_fetch_every_15m';
-- SELECT * FROM net.http_request_queue ORDER BY created DESC LIMIT 20;
