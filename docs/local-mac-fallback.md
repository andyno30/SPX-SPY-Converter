# Local Mac fallback

Current status: News and all 19 Options tickers are implemented and verified
with real Supabase updates. The combined LaunchAgent is installed and enabled
for this Mac; its first automatic run completed successfully with exit code 0.
Existing Supabase functions, cron, frontend, schemas, RLS, Pro authorization,
manual fallback, and Options refresh gate are unchanged.

## Local credentials

Only the repository-root `.env.local` supplies backend credentials:

```dotenv
PROJECT_URL=your-project-origin
SERVICE_ROLE_KEY=your-backend-service-role-key
```

The updater never reads `news-app/.env.local`. Git ignores the root file,
temporary `.env.local.*` files, and `.local-fallback/` runtime files.
Do not put secrets in command arguments, commits, logs, or chat.

The local updater uses only `UPSTREAM_ACCESS_TOKEN` from root `.env.local` for
Options authentication. It never loads browser storage or session files.
GitHub's `SAVETICKER_AUTH_JSON_B64` secret is unchanged. To renew the local token
when the authorized application session expires:

1. In your normal browser, open your already authorized SaveTicker session.
2. Open developer tools and locate Cookies for `https://saveticker.com`
   (Chrome: Application → Storage → Cookies).
3. Copy only the **value** of the `access_token` cookie. Do not copy a request,
   Cookie header, `cf_clearance`, or the cookie table.
4. In a local Terminal, run:

   ```sh
   cd '/Users/andyno/Desktop/Spyconverter (2026)'
   python3 scripts/configure_upstream_token.py
   ```

5. Paste at the hidden prompt and press Enter. The helper writes only
   `UPSTREAM_ACCESS_TOKEN` alongside the existing backend variables in root
   `.env.local`, with file permissions `0600`. It clears the clipboard if it
   still contains exactly the copied token. Existing frontend files and GitHub
   secrets remain untouched. If the cookie is absent, sign in normally first.

The helper does not verify the token. Options requests use only the application
`access_token` cookie: a fresh Chromium context on macOS, ordinary HTTP on other
platforms. Initial verification passed in SPY, QQQ, SNDK,
then remaining allowlist order. A SPY request failure stops the Options loop.
A failed run is retried at the next scheduled interval; there is no challenge
bypass or automatic token rotation.

## News operation

```sh
python3 scripts/local_fallback.py --news-only --dry-run
python3 scripts/local_fallback.py --news-only
```

Each run reads Reuters and Financial Juice freshness independently from
`news_articles`. A `fetched_at` or `published_at` within 15 minutes makes that
source fresh. CNBC never satisfies this check. With both sources fresh, no
upstream requests are made. When either is stale, the Mac updater fetches group 1
then group 6 through standard headed Playwright Chromium, without authentication,
imported cookies, custom headers, or challenge handling. Both feeds can contain
both sources. Other platforms retain their existing HTTP News retrieval.

The LaunchAgent's Python interpreter and configuration do not change. On macOS,
`scripts/news_browser.py` starts a bounded worker using `.venv/bin/python`, where
Playwright and Chromium are installed. To prepare this dependency on a new Mac:

```sh
.venv/bin/python -m pip install -r scripts/requirements-news.txt
.venv/bin/python -m playwright install chromium
```

Each fetch uses a fresh temporary profile, closes Chromium, and removes the
profile. The worker receives no backend credentials; only the existing updater
accesses Supabase. Article bodies and unrelated upstream fields are excluded
from the worker pipe. HTTP errors, HTML responses, invalid JSON, and Cloudflare
challenges fail closed without retries. A challenge is logged explicitly.

Headed Chromium passed repeated isolated tests under the existing LaunchAgent's
system Python, working directory, and logged-in GUI session on October 8, 2026.
Headless Chromium returned a challenge and is not used. A Chromium window can
appear briefly during a stale-News refresh. The Mac must remain logged in,
awake, and online; upstream access can still change.

Existing Python normalization supplies English titles, source identities,
timestamps and tickers. A small adapter matches the production database row
shape and its HTML/English guards. Both responses must pass JSON/schema
validation before writes. The updater rechecks source freshness after fetching
and before inserting, compares source/external-ID keys, and uses the existing
unique constraint with `resolution=ignore-duplicates`. It never updates or
deletes News rows. Concurrent duplicate inserts cannot replace manual rows.

Dry-run performs these reads/comparisons without writes. A filesystem lock
prevents overlapping local runs. Browser startup/navigation have 25-second
timeouts, and the parent enforces a 90-second deadline for the entire browser
worker. On failure or interruption it terminates the worker's process group,
including Chromium, before removing the profile. Existing HTTP requests retain
their 20-second timeout and redirect rejection. The CLI retains its ten-minute
overall limit. Diagnostics contain status and counts, never bodies, cookies,
credentials, or request headers. A News failure still allows Options to run.

Freshness is based on inserted news, because the existing schema has no
source-specific successful-poll timestamp. A quiet feed with no new articles may
therefore be checked again on a later run, without rewriting old articles.

## Options protection

The updater reads the ticker allowlist directly from
`supabase/functions/fetch-spy-options/index.ts` on every run. It imports the
existing Python validation and normalizer from `sync_direct.py`, now accepting
an optional ticker argument with the original SPY default. On macOS,
`scripts/options_browser.py` retrieves each stale ticker in standard headed
Chromium, then returns the raw JSON to that same validator and normalizer.
Other platforms retain their existing HTTP retrieval. `fetchedAt` is added to
match the Edge response schema; `gammaPer1Pct` remains the Net GEX mapping.

Each ticker uses a fresh non-persistent browser context with only the application
`access_token` from root `.env.local`. The worker receives this token through a
private stdin pipe, never command arguments, environment variables, or a saved
session. It never receives Supabase credentials. Only the exact requested API
navigation is allowed; redirects, other origins, and subresources are blocked.
No existing browser state, Cloudflare cookies, analytics cookies, custom browser
fingerprints, or challenge handling are used.

The worker uses the same `.venv` Playwright/Chromium installation as News. Each
worker has a 60-second overall deadline; its process group and temporary files
are cleaned up on success, failure, timeout, or service stop. A failed SPY fetch
still stops the Options loop. No retry loop or production refresh-gate change
is introduced. Browser windows may appear briefly for stale tickers.

The production schema maps upstream `snapshotUpdatedAt || batchUpdatedAt` to
`payload.sourceUpdatedAt`, preserves `asOf`, and records `payload.fetchedAt`.
The table also has `source_updated_at`, `fetched_at`, `last_attempted_at`, and
`refresh_started_at`. The updater considers the payload and table timestamps
when checking the 15-minute freshness threshold. Payload-only manual edits
therefore remain protected even when table `fetched_at` is old.

For each stale ticker, it fetches JSON, normalizes it, and rereads the cache.
Snapshot timestamps and `asOf` cannot regress. Gamma data has a separate
upstream `gammaUpdatedAt` clock: SPY/QQQ/IWM can receive newer gamma values
while `snapshotUpdatedAt` stays unchanged. The updater keeps that revision in
memory without adding keys to the website's payload or changing its normalizer.
Equal-snapshot updates require changed gamma/price fields with a provably newer
gamma revision; other snapshot fields must remain unchanged. Changes only to
`fetchedAt` or `nextPollAfterMs` never justify an update. Changed gamma values
without a newer gamma timestamp remain protected.

After a verified conditional write, `.local-fallback/options-revisions.json`
stores only the gamma revision and a SHA-256 hash of the payload plus table
source/fetch timestamps. This ignored owner-only file contains no payload or
authentication data. When that hash still matches the database, later runs can
compare the exact gamma revisions even if upstream publication is delayed.
A manual/live cache edit invalidates the hash; an equal-snapshot gamma update
then fails closed rather than overwriting an edit of unknown age.

Legacy rows without local revision metadata require a gamma revision strictly
later than both their source and recorded observation/fetch timestamps before
changed gamma values can be replaced. Missing or malformed evidence is skipped.
The fallback does not change or claim the production refresh gate, and the
weekday 05:30–14:00 Pacific Options fetch window remains in place.

Writes use a conditional PATCH matching the entire previous JSONB payload and
all cache timestamp/gate columns. If a manual or live update changes the row
between read and write, the database affects zero rows and the fallback skips.
Missing rows are inserted with ignore-duplicates, never unconditional upsert.
Successful writes are read back for verification. Dry-run performs no writes.

## Schedule and controls

The user LaunchAgent is `com.spyconverter.local-fallback`, configured with
`RunAtLoad=true` and `StartInterval=900`. It runs after login and checks every
15 minutes while the Mac is awake and connected. The freshness threshold is
also 15 minutes, so data becomes eligible at the next interval. A newer manual
or Supabase refresh can still make a ticker/source fresh and skip its fallback.
Options writes still require genuinely newer upstream data. macOS can defer
runs while asleep; no sleep settings are changed. The job does not need an
open Terminal and remains scheduled after script errors.

From the repository root:

```sh
python3 scripts/local_fallback_service.py status
python3 scripts/local_fallback_service.py run
python3 scripts/local_fallback_service.py stop
python3 scripts/local_fallback_service.py start
python3 scripts/local_fallback_service.py logs
```

`stop` unloads and disables this job; `start` enables and loads it. `run` asks
launchd to run now without killing an active run. It returns before the background
check finishes; use `logs` to see the result. Manual runs use the same 15-minute
freshness threshold and data-protection checks. The OS job and filesystem lock
prevent overlap. `status` showing `state = not running` and `last exit code = 0`
means the enabled job completed normally and is waiting for its next interval.

To install on a different Mac after configuring local credentials, run
`python3 scripts/local_fallback_service.py install`. This generates a local plist
under `~/Library/LaunchAgents/`; no machine-specific plist or secrets are committed.
macOS may ask Python for Desktop folder access because this repository is on
the Desktop; approve that OS prompt yourself if it appears.

Safe operational logs are in `.local-fallback/fallback.log`, rotated at 1 MB
with three backups. Launchd startup errors go to `.local-fallback/launchd.log`.
No payloads, credentials, cookies, request headers, or auth files are logged.
All local environment files and runtime logs are Git-ignored.

## Mac News browser rollback and deployment

This change activates locally as soon as the updated Python files are present;
the LaunchAgent needs no restart or reinstall. No frontend, Edge Function, or
database deployment is involved. This repository's main branch is connected to
Vercel News and Journal deployments, so a local-only updater commit must not be
pushed unless those deployment effects are intentionally addressed.

To restore the pre-browser News retrieval on this checkout without changing the
schedule, restore just the updater from its rollback revision:

```sh
git restore --source=aeae24d -- scripts/local_fallback.py
```

The next run will use the previous HTTP implementation; on October 8 that
implementation was receiving 403 responses. Existing database rows remain intact.

## Verification on October 9, 2026

- Options HTTP retrieval began receiving Cloudflare challenges. Standard headed
  Chromium returned HTTP 200 and valid Options JSON for SPY, QQQ, SNDK, then all
  remaining allowlisted tickers, using only the existing application token.
- An isolated unattended LaunchAgent dry-run passed all 19 tickers without writes.
  The production schedule was unchanged during testing and activation.
- Automatic production run 1260 finished at 7:11 AM Pacific with exit code 0:
  all 19 Options tickers updated and passed readback verification. News also
  succeeded in the same run. The live SPY page displayed October 9 market data.
- All 19 source timestamps advanced without regressing `asOf`; payload schemas
  and gamma provenance were preserved. Local writes still exclude refresh-gate
  fields. Opening the SPY page subsequently advanced its Edge refresh-attempt
  timestamp through the existing page-triggered policy; other gate fields stayed
  unchanged. No Edge Function, schema, refresh policy, or News code was changed.
- A post-update dry-run skipped all 19 fresh caches with zero browser requests
  and zero database writes.
- Python: 111 passed, 6 Windows-only skipped. JavaScript: 10 passed. Syntax and
  whitespace checks passed. No browser workers or temporary profiles remained.
- The user's October 9 daily ratio update (`7e8e278`) was preserved unchanged.
  Credentials stayed in root `.env.local`; no credential values entered code,
  logs, command arguments, browser profiles, or the worker environment.

## Verification on October 8, 2026

- Both News groups returned HTTP 200 and valid JSON in repeated fresh Chromium
  profiles, including two unattended runs under a temporary LaunchAgent matching
  the production interpreter and GUI-session conditions. The test job was removed.
- The controlled production run inserted 80 Reuters and 57 Financial Juice
  articles and exited successfully. Both sources appeared on the live News page.
- All 18,660 pre-existing News rows were unchanged, with no Reuters/FJ duplicate
  keys. All 19 Options payloads and timestamps were unchanged; CNBC was unchanged.
- A subsequent live dry-run skipped both fresh sources without fetching upstream.
- The next automatic production run completed at 9:03 PM Pacific, with both groups
  returning HTTP 200/valid JSON and exit code 0. It inserted one additional Reuters
  article; Financial Juice had no new articles. Launchd advanced to run 1254 with
  the original 900-second interval and `RunAtLoad=true`, without a manual trigger.
- Python: 100 passed, 6 Windows-only skipped. JavaScript: 10 passed. Python syntax
  and Git whitespace checks passed. Tests cover browser errors, source freshness,
  deduplication, manual/concurrent updates, Options preservation, worker timeouts,
  and termination/profile cleanup when stopping the service.
- Root credentials and the production LaunchAgent plist were unchanged. Browser
  profiles are temporary; local secrets, dependencies, and logs remain Git-ignored.

## Verification on September 21, 2026

- Local News group 1: HTTP 200, valid JSON.
- Local News group 6: HTTP 200, valid JSON.
- Dry-run: 7 new Reuters articles and 2 new Financial Juice articles.
- Real update: inserted exactly those 9 articles.
- Compared 300 preexisting rows across Reuters, Financial Juice and CNBC:
  all unchanged after the update.
- Follow-up dry-run: both sources fresh; no upstream requests or writes.
- Options: SPY, QQQ, SNDK, and every remaining allowed ticker returned HTTP 200
  and valid JSON. Dry-run found 19 stale caches with strictly newer source data.
  The live run updated all 19 through conditional PATCH and verified each row.
- launchd: installed/enabled, 900-second interval. First automatic run exited 0,
  skipped both fresh News sources and all 19 fresh Options tickers, and logged
  `Run complete: mode=live, failures=0`.
- Gamma comparator follow-up: SPY, QQQ and IWM had a newer `gammaUpdatedAt`
  despite unchanged snapshot timestamps. Controlled dry-runs and conditional
  writes updated those three and verified the results; the other 16 payloads
  were preserved. AMD/MU value changes without a newer gamma revision were
  deliberately rejected. These one-off diagnostic requests did not change the
  scheduled Options hours, News behavior, or launchd configuration.
- Safety/regression tests cover manual edits, equal/older source timestamps,
  concurrent refreshes, dry-run, overlap, cookie restrictions, and scheduling.

The Mac must be awake and connected. Session expiration may require renewing
only the local application token with the hidden-input helper.

Run local safety tests with:

```sh
python3 -m unittest discover -s scripts -p 'test_*.py' -v
node --test scripts/test_news_dates.cjs scripts/test_upstream_diagnostics.cjs
```


## Mac Options browser rollback

To restore the previous Options HTTP fetcher while retaining the working News
browser integration and the existing schedule:

```sh
git restore --source=7e8e278 -- scripts/local_fallback.py
```

The previous Options HTTP path was receiving Cloudflare challenges on October 9,
2026. This rollback does not change stored data, credentials, or the LaunchAgent.
