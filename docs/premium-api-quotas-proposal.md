# Premium API quotas — LOCALLY VERIFIED — NOT PRODUCTION APPROVED

Prepared October 15, 2026. Production migration, deployment and quota activation
remain **not approved**. This work changes local code/tests/documentation only.
No production Supabase connections, real subscriber changes, or changes to the
completed News deployments were made. A local commit is permitted; pushing would
trigger website deployment and is outside this stage.

## Limits and authorization

| API/resource | Independent fixed UTC windows | Counter identity | Deployment opt-in guard |
| --- | --- | --- | --- |
| `contact-for-licencing` / `pro-prices` | 60/minute **and** 1,200/hour | verified Supabase user ID + resource | `PRO_PRICE_QUOTAS_ENABLED=true` |
| Premium `fetch-spy-options` tickers / `premium-options` | 60/minute **and** 600/hour across all premium tickers | verified Supabase user ID + resource | `PREMIUM_OPTIONS_QUOTAS_ENABLED=true` |

Both guards are off unless exactly `true`. The new database controls also default
to `enabled=false`; both gates must allow enforcement. Changing IP, token, tab or
premium ticker does not create a new budget. Pro and Options budgets are separate.
Fixed windows permit bursts spanning a boundary; they are not rolling limits or
a complete defense against slow paid scraping.

Every premium request verifies its JWT and current `profiles.is_subscribed`
before quota evaluation. Anonymous identities and unsubscribed accounts remain
rejected during emergency disable. Expired subscriptions are represented by the
existing billing system setting `is_subscribed=false`; quotas neither change that
system nor grant entitlements. Pro's combined membership/snapshot read remains
before quota checks, so quotas limit data delivery rather than all database reads.

Public SPY bypasses authentication and premium quotas. CORS preflight, rejected
methods/tickers/contracts, invalid sessions and unsubscribed requests do not
consume quota. Admitted retries/reloads/disconnected requests count separately;
an admission followed by a data error is not refunded.

## Runtime disable and failure behavior

`premium_api_quota_control` is owner/admin writable only. Service role reads it
through `read_premium_api_quota_control(text)`. Every authorized quota attempt
reads it anew, without an instance or TTL cache. The consume RPC locks and
rechecks control before counting. Denials/failures trigger another fresh read.

| State | Behavior after existing authentication/subscription checks |
| --- | --- |
| Deployment guard off | Existing authorized response; no quota RPC |
| Runtime control disabled, missing, malformed or unreachable | Bypass quota only; do not consume counters |
| Verified enabled; budget available | Consume one request and return existing data |
| Verified enabled; budget exhausted | HTTP **429**, `RATE_LIMITED`, numeric `Retry-After` |
| Still verified enabled; counter RPC fails/malforms/times out | HTTP **503**, `QUOTA_UNAVAILABLE`, `Retry-After: 5` |
| Auth, entitlement or quote dependency fails | Existing failure; quota disable does not bypass it |

Errors are JSON, `private, no-store`, `Vary: Authorization`, with CORS exposure
of `Retry-After`. Control calls have a two-second client timeout, counters five
seconds. Unverifiable control deliberately disables abuse quotas to preserve
subscriber access; **JWT and membership authorization remain enforced**. Logs
contain generic failure events without tokens, user IDs or database error details.

The prepared emergency action is `supabase/sql/premium_api_quotas_emergency_disable.sql`:

```sql
begin;
update public.premium_api_quota_control
set enabled = false, updated_at = clock_timestamp()
where resource in ('pro-prices', 'premium-options')
returning resource, enabled, updated_at;
commit;
```

Use an owner/admin session, not an application token. Select one resource for
independent rollback. **Commit is the effective boundary**: earlier accounting
transactions can finish first; subsequent accounting sees disabled state.
Already transmitted/in-flight responses cannot be recalled. Tests verify recovery
on the same running handlers without a deployment. This is not a promise of zero
network latency or recovery from an authentication database outage. Client timeout
does not guarantee server query cancellation; hosted statement/transaction timeouts
must be verified in staging.

Environment guards remain rollout safeguards, not the emergency mechanism.
[Supabase documents immediate secret updates without redeployment](https://supabase.com/docs/guides/functions/secrets).
The new per-request database control avoids relying on module initialization or
isolate replacement to disable enforcement.

## Browser behavior and ordinary usage

Pro, Dow/Russell, the chart and premium Options recognize 429 and limiter 503
separately. They parse seconds/HTTP-date Retry-After, cap it at one hour, suppress
normal requests during cooldown, retain usable data and show readable errors.
Dow/Russell errors are now visible. Chart reset replaces history only after a
successful response. Calculations and normal polling intervals are unchanged;
switching instruments cannot reuse a mismatched quote.

Cooldown metadata is scoped to user/resource and shared across same-origin tabs
and reloads. It contains no credentials or premium payload. This is a browser
courtesy, not a security boundary. Separate origins, disabled storage and requests
already in flight still rely on backend limits.

An explicit **Retry now** action permits a bounded recovery probe before the
original Retry-After expires. A successful probe clears only its captured cooldown
generation, allowing already-open tabs to recover after emergency disable. Failed
probes do not cause automatic retry loops. Web Locks/shared storage coordinate one
probe per user/resource per 15 seconds. Without those capabilities the browser
retains normal cooldown behavior.

| Typical usage | Requests per account, excluding extra reloads/actions |
| --- | --- |
| One Pro, Dow or chart tab | 60 Pro/hour |
| All three Pro pages | 180 Pro/hour |
| Ten Pro page tabs | 600 Pro/hour |
| One premium Options tab | 4 Options/hour |
| Eighteen premium Options tabs | 72 Options/hour |

The executed one-hour simulation used Pro + Dow + chart and three premium Options
tabs, two reloads, an ES selection, chart reset, two Options manual refreshes and
a ticker switch: **183 Pro requests (peak 4/minute)** and **16 Options requests
(peak 3/minute)**. Both independent limits retained substantial headroom.

Initial loads/reloads, contract selections, chart resets and admitted manual
refreshes add requests. Normal scenarios have headroom, but unlimited tabs cannot
be promised: 20 continuously polling Pro tabs consume the entire hourly allowance;
21 can exhaust it. A boundary can move a request between windows. Calibrate limits
using staging observations before activation; these are not measured production
traffic figures. Normal polling resumes on its existing interval after cooldown,
or the user can request the bounded recovery probe.

## Database safety and unaffected producers

Setup adds **two** tables (control/counters) and **three** RPCs (read/consume/purge).
Tables live in `public` for the existing RPC architecture but are private to
ordinary clients: RLS enabled, all table privileges revoked from PUBLIC, anon,
authenticated and service_role. Even service role with `BYPASSRLS` cannot directly
read/change/reset counters. RPCs use SECURITY DEFINER, an empty search path and
owner/admin ownership; only service_role has EXECUTE among application roles.
Users cannot alter control, choose limits or manipulate counters through RPCs.

Counters have a user/resource primary key and an `auth.users` FK with deletion
cascade. Both window checks/increments occur under one row lock using database
time after locking. A bounded retry handles cleanup deleting a stale row between
conflict detection and row locking. Denials do not increment or extend windows.
There are at most two rows per account, with no IP/token/request history.

The optional scheduler creates only `premium_api_quota_cleanup`, hourly at minute
17, deleting at most 1,000 counters inactive for seven days with `SKIP LOCKED`.
Backlog may extend retention. Existing jobs are untouched. Setup/rollback do not
modify entitlement/billing rows. Reapplying setup preserves counts and control
state; it does not silently re-enable quotas.

Repository callgraph review found no quota dependency in `refresh-pro-prices`, its
claim/finish/release RPCs, News cron/ingestion, Mac fallback, SaveTicker Playwright
fetches, manual JSON importer, CNBC/daily ratio flows or billing. Those sources and
existing scheduler definitions are unchanged. `spy-ingest` is unchanged; deployed
source is absent from this checkout and its known malfunction was not investigated
again. Local regressions/static review are not new live producer verification.

## Local results — October 15, 2026

All tests use synthetic identities/data. No tests call production Supabase,
Stripe, Yahoo, SaveTicker or News services.

| Check | Result and evidence |
| --- | --- |
| Real PostgreSQL concurrency | PASS — 80 distinct simultaneous backend sessions: exactly 60 admitted / 20 denied |
| Resets and isolation | PASS — both hourly budgets, separate users/resources, actual minute crossing while locked, seeded hour reset, cleanup race and bounded SKIP LOCKED cleanup |
| Runtime disable | PASS — disable commit ordering; stale enabled reads cannot count afterwards; reused handlers recover |
| Privacy and rollback | PASS — table/RPC ACLs including BYPASSRLS service role; reapply/rollback preserve mock subscribers and unrelated mock cron jobs |
| Local HTTP integration | PASS — 1 suite/7 steps, four reused handlers, signed JWT adapter, expired/anonymous/revoked access, rotated tokens, 80 HTTP requests, public SPY, 429/503/control-outage recovery |
| Deno regressions | PASS — 46 quota/auth/pricing/updater/provider tests |
| SQL/billing/News/retired endpoint | PASS — 38 TAP results, including 8 quota SQL results |
| Importer allowlist | PASS — 1 test |
| Frontend | PASS — 23 tests of actual consumers, including calculations, hour-long polling, cooldowns, token refresh and bounded emergency recovery; independently reviewed/rerun |
| Edge entrypoints | PASS — both typecheck |
| Hosted Supabase staging / production activation | OUTSTANDING / NOT APPROVED |

The real PostgreSQL suite has 11 checks plus its enclosing suite (12 TAP results).
It uses pinned `@embedded-postgres/darwin-arm64@18.4.0-beta.17` and `pg@8.23.1` in
temporary storage. The server reports PostgreSQL 18.4. Its private Unix socket has
TCP disabled and contains only fixtures. Reproduction/shutdown instructions are
in `tests/helpers/premium-quota-postgres-runtime.cjs`. This third-party packaged
server is not the Supabase runtime.

HTTP tests import the actual Pro request handler, Options access guard and quota
helper, with a local HMAC JWT/auth adapter and fixture quote/Options payloads.
They do not validate hosted Auth, PostgREST, Edge gateway behavior, or the full
Options provider/cache path. Scheduler tests stub pg_cron to verify job selection,
not extension execution. Hour resets use old stored windows; the minute-boundary
test actually crosses wall-clock time. PGlite supplements, rather than replaces,
real multi-session testing.

Local browser verification used the actual Dow/Russell page with local adapters:
429 retained ratios, polling/reload/second-tab requests respected cooldown, a
failed Retry now probe blocked another tab for 15 seconds, and a successful probe
restored both tabs before the original one-hour deadline. Screenshots are saved
outside the repository in the task's `quota-local-tests` evidence directory.

Run from the repository root with temporary dependencies:

```sh
node tests/helpers/premium-quota-postgres-runtime.cjs start
node --test tests/premium_quota_postgres_test.cjs
deno test --no-lock --allow-all tests/premium_quota_application_test.ts
deno test --no-lock tests/premium_quota_test.ts tests/pro_price_request_test.ts tests/pro_prices_test.ts tests/pro_price_updater_test.ts tests/pro_price_yahoo_test.ts
NODE_PATH=/private/tmp/spyconverter-premium-quota-tests/node_modules node --test tests/premium_quota_sql_test.cjs tests/pro_price_access_snapshot_sql_test.cjs tests/pro_price_cache_sql_test.cjs tests/pro_billing_test.cjs tests/billing_flows_test.cjs tests/news_ingestion_auth_test.cjs tests/pro_endpoint_retirement_test.cjs
NODE_PATH=/private/tmp/spyconverter-frontend-test/node_modules node --test tests/pro_frontend_test.cjs tests/premium_frontend_quota_test.cjs
deno check --no-lock supabase/functions/contact-for-licencing/index.ts supabase/functions/fetch-spy-options/index.ts
node tests/helpers/premium-quota-postgres-runtime.cjs stop
```

## Remaining hosted staging and approval order

No staging project is available. The user chose isolated local tests only.
Before production approval, use a separate project and synthetic accounts to:

1. Apply/reapply setup on its supported PostgreSQL version. Verify actual owners,
   ACLs/RLS, FK/indexes, PostgREST anon/authenticated/service-role access, schema
   cache and role/transaction timeouts. Exercise real pg_cron and targeted rollback
   while preserving fixture subscribers and unrelated jobs.
2. Deploy exact functions with guards off and controls false. Test real Supabase
   tokens, refresh/expiry, anonymous users, revoked membership, billing fixtures,
   all premium tickers, public SPY, CORS and browsers. Check gateway JWT settings
   and the complete Options cache/provider path.
3. Enable staging quotas only. Repeat contention through deployed Edge instances;
   test 429, counter failure/timeout, unknown control, owner disable, and browser
   Retry now. Verify already-running isolates observe disable; measure latency,
   lock waits and database load under expected traffic.
4. Test fixture versions of cron, ingestion, importer/Mac fallback and internal
   automation, without running production jobs or using real subscriber budgets.
5. Review legitimate usage/thresholds, failure logs, response rates and cleanup
   health. Obtain explicit production migration/deployment/activation approval;
   capture current deployment/rollback artifacts before any production action.

Only after those pass and approval is given: install the additive migration with
controls false, deploy disabled functions/frontend, smoke-test ordinary access,
then activate Pro and Options separately with bounded test-account checks and
monitoring. Do not simulate dependency failures in production. The design supports
no planned subscriber outage, but local tests alone cannot guarantee uninterrupted
hosted service or justify activation.

## Rollback

Commit emergency disable first and verify authorized responses on running
functions. Keep rollout guards false for later deployments as appropriate. Leave
inactive tables initially. A browser already cooling down can use Retry now;
restoring captured prior function/frontend deployments is also available after
approval.

Only after enforcement is disabled and removal separately approved, run
`premium_api_quotas_rollback.sql`. It removes only the dedicated job, three RPCs
and two quota tables, without CASCADE or edits to users, subscriptions, prices,
Options data or unrelated cron jobs. It intentionally discards accounting
history; setup can later recreate empty, disabled quota objects.
