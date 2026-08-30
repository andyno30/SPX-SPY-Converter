-- SpyConverter News comments and bullish/bearish reactions.
-- Public reading; authenticated writes only. Safe to rerun.

CREATE TABLE IF NOT EXISTS public.news_reactions (
  article_id BIGINT NOT NULL REFERENCES public.news_articles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL CHECK (reaction IN ('bullish', 'bearish')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (article_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.news_comments (
  id BIGSERIAL PRIMARY KEY,
  article_id BIGINT NOT NULL REFERENCES public.news_articles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_reactions_article
  ON public.news_reactions (article_id, reaction);

CREATE INDEX IF NOT EXISTS idx_news_comments_article_created
  ON public.news_comments (article_id, created_at DESC);

ALTER TABLE public.news_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "news_reactions_public_read" ON public.news_reactions;
DROP POLICY IF EXISTS "news_reactions_insert_own" ON public.news_reactions;
DROP POLICY IF EXISTS "news_reactions_update_own" ON public.news_reactions;
DROP POLICY IF EXISTS "news_reactions_delete_own" ON public.news_reactions;
DROP POLICY IF EXISTS "news_comments_public_read" ON public.news_comments;
DROP POLICY IF EXISTS "news_comments_insert_own" ON public.news_comments;
DROP POLICY IF EXISTS "news_comments_update_own" ON public.news_comments;
DROP POLICY IF EXISTS "news_comments_delete_own" ON public.news_comments;

CREATE POLICY "news_reactions_public_read"
  ON public.news_reactions FOR SELECT USING (true);
CREATE POLICY "news_reactions_insert_own"
  ON public.news_reactions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "news_reactions_update_own"
  ON public.news_reactions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "news_reactions_delete_own"
  ON public.news_reactions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "news_comments_public_read"
  ON public.news_comments FOR SELECT USING (true);
CREATE POLICY "news_comments_insert_own"
  ON public.news_comments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "news_comments_update_own"
  ON public.news_comments FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "news_comments_delete_own"
  ON public.news_comments FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'news_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.news_reactions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'news_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.news_comments;
  END IF;
END
$$;

-- Remove the retired source after its fetch configuration is disabled.
DELETE FROM public.news_articles WHERE source = 'Yahoo Finance';
