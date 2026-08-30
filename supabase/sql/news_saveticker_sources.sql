-- SaveTicker-backed Reuters and Financial Juice metadata support.
-- The public table stores only normalized headlines/metadata, never auth or bodies.

ALTER TABLE public.news_articles
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS headline_only BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.news_articles
  ALTER COLUMN original_url DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_news_source_external_id_unique
  ON public.news_articles (source, external_id);

CREATE INDEX IF NOT EXISTS idx_news_external_id
  ON public.news_articles (external_id)
  WHERE external_id IS NOT NULL;
