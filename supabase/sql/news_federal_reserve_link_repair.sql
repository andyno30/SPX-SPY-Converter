-- One-time repair for Federal Reserve URLs saved with raw CDATA wrappers.
-- Safe against unique(original_url) collisions.
-- Run in Supabase SQL Editor.

-- 1) Drop rows where the cleaned URL already exists on another row.
--    (These are duplicates and would otherwise violate unique(original_url) on update.)
WITH cdata_rows AS (
  SELECT
    id,
    regexp_replace(
      regexp_replace(original_url, '^<!\[CDATA\[', ''),
      '\]\]>$',
      ''
    ) AS cleaned_url
  FROM public.news_articles
  WHERE source = 'Federal Reserve'
    AND original_url LIKE '<![CDATA[%]]>'
)
DELETE FROM public.news_articles n
USING cdata_rows c
WHERE n.id = c.id
  AND EXISTS (
    SELECT 1
    FROM public.news_articles keep_row
    WHERE keep_row.id <> c.id
      AND keep_row.original_url = c.cleaned_url
  );

-- 2) Clean remaining CDATA-wrapped URLs.
WITH cdata_rows AS (
  SELECT
    id,
    regexp_replace(
      regexp_replace(original_url, '^<!\[CDATA\[', ''),
      '\]\]>$',
      ''
    ) AS cleaned_url
  FROM public.news_articles
  WHERE source = 'Federal Reserve'
    AND original_url LIKE '<![CDATA[%]]>'
)
UPDATE public.news_articles n
SET original_url = c.cleaned_url
FROM cdata_rows c
WHERE n.id = c.id;

-- 3) Fallback any remaining invalid Fed links to the Fed news hub.
UPDATE public.news_articles
SET original_url = 'https://www.federalreserve.gov/newsevents.htm?ref=' || id::text
WHERE source = 'Federal Reserve'
  AND original_url !~* '^https?://(www\.)?federalreserve\.gov/newsevents(/pressreleases/[a-z]+[0-9]{8}[a-z]?\.htm)?([?#].*)?$';
