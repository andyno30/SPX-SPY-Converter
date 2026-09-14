-- Correct archived SEC releases imported with 2026 publication years.
-- Dates verified against the SEC's 1997 and 1999 press release archives:
-- https://www.sec.gov/news/press/pressarchive/1997press.shtml
-- https://www.sec.gov/news/press/pressarchive/1999press.shtml
-- Preserve the rows, IDs, and existing time-of-day convention. The news page's
-- existing 2020 cutoff excludes them once the publication years are corrected.
-- Deploy the SEC date validation in fetch-news to prevent new bad imports.
BEGIN;

WITH corrections(original_url, wrong_date, correct_date) AS (
  VALUES
    ('https://www.sec.gov/newsroom/press-releases/97-114-municipal-securities-underwriters-pay-total-325000-fines',
     '2026-12-16T12:00:00Z'::timestamptz, '1997-12-16T12:00:00Z'::timestamptz),
    ('https://www.sec.gov/newsroom/press-releases/97-99-sec-chairman-arthur-levitt-iowa-officials-hold-investors-town-meeting-des-moines',
     '2026-11-05T12:00:00Z'::timestamptz, '1997-11-05T12:00:00Z'::timestamptz),
    ('https://www.sec.gov/newsroom/press-releases/99-110-presidents-year-2000-council-sec-nyse-nasd-ici-sia-outline-securities-industry-efforts-smooth',
     '2026-09-07T12:00:00Z'::timestamptz, '1999-09-07T12:00:00Z'::timestamptz)
)
UPDATE public.news_articles AS article
SET published_at = corrections.correct_date
FROM corrections
WHERE article.source = 'SEC'
  AND article.original_url = corrections.original_url
  AND article.published_at = corrections.wrong_date
RETURNING article.id, article.title, article.published_at;

COMMIT;
