# Reuters and Financial Juice updater operations

The public page is [news.spyconverter.com/news](https://news.spyconverter.com/news).
Visitors read News rows from Supabase; their browsers never call SaveTicker.

## Data flow

`.github/workflows/update-saveticker-news.yml` runs about every 15 minutes and can
also be started manually from **Actions → Update SaveTicker News → Run workflow**.
It restores the encrypted `SAVETICKER_AUTH_JSON_B64` secret into a temporary
runner file, runs `scripts/sync_saveticker_news.py`, commits the normalized
`data/saveticker-news.json` cache only when it changes, and removes the temporary
session file.

The existing Supabase `fetch-news` function reads that normalized cache during
its 15-minute news update and inserts new rows into `public.news_articles`.
Reuters and Financial Juice rows are deduplicated by `(source, external_id)`.

The SaveTicker updater polls only the two confirmed list feeds and filters exact
source values:

- `reuters` → `Reuters`
- `financial-juice` → `Financial Juice`

English titles come from `translations.translated.en_US.title`, with an English-
safe top-level title fallback. Source time uses `extra.source_created_at`, then
`created_at`. Only the ID, source, title, timestamp, actual ticker metadata,
headline-only flag, and a null URL reach the public cache.

The updater makes no `/api/news/detail` calls. Reuters article bodies,
translations, raw responses, cookies, and authorization data are never stored in
the repository or Supabase.

## Failure safety

The updater writes atomically only after both list requests return valid JSON and
at least one target-source item is found. HTTP 401/403, rate limits, server
errors, timeouts, invalid JSON, or unexpected schemas leave the previous cache
unchanged. The Supabase importer likewise leaves existing rows intact if the
normalized cache cannot be read.

## Refresh authentication

Use the existing private session refresh flow:

```bash
python -m pip install -r scripts/requirements-saveticker.txt
python -m playwright install chromium
python scripts/refresh_saveticker_auth.py
```

After manually signing in, replace the GitHub Actions secret with a fresh base64
encoding of the ignored `saveticker-auth.json` file:

```bash
base64 < saveticker-auth.json | pbcopy
```

Never commit or paste the decoded session into logs, issues, or source files.

## Manual checks

Run a local cache update with an ignored local session:

```bash
python scripts/sync_saveticker_news.py
```

Or point to a session held outside the repository:

```bash
SAVETICKER_AUTH_FILE=/private/path/saveticker-auth.json \
  python scripts/sync_saveticker_news.py
```

Deploy/run the server-side importer with:

```bash
supabase functions deploy fetch-news --no-verify-jwt
```

The production updater can be verified in GitHub Actions and the Supabase Edge
Function logs. In browser developer tools, refreshing `/news` should show
Supabase requests and no request to `saveticker.com`.
