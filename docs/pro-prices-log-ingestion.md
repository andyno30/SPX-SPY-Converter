# Pro log ingestion reduction — October 2, 2026

The September 28 and October 2 screenshots show ingestion growing from 0.467 GB
to 0.718 GB (+251 MB), while Log Query grew from 473.176 to 474.178 GB. Those are
billing-period totals, not stored cache size or Yahoo response traffic.

## Findings

A bounded one-hour sample before this change contained approximately 2.05 MB of
event-message plus JSON-serialized attribute payloads:

| Log source | Share of sampled payload |
| --- | ---: |
| API gateway (`edge_logs`) | 51.1% |
| Function invocation HTTP logs (`function_edge_logs`) | 22.7% |
| Function runtime and console logs | 17.4% |
| Postgres | 4.1% |
| Auth and remaining services | 4.7% |

These payload calculations are diagnostic estimates, not Supabase's official
ingestion-byte accounting, and one hour is not a monthly traffic forecast.
The dominant source was routine requests, not a runaway Pro error loop.
The sample included 180 Yahoo success diagnostics (about 108 KB), 60 private
price-cache reads, and 67 profile reads. The scheduled updater had 59 HTTP
invocations. A separate 15-minute status sample showed its POSTs succeeding.

Database logging was already restrained: connections/disconnections and duration
logging off; statement logging `ddl`; minimum message level `warning`; no broad
role-level audit/debug overrides. No database logging settings were changed.

## Changes

1. `read_pro_price_access_snapshot(uuid)` combines the existing subscription and
   price snapshot reads in one request. It is a stable, security-invoker SQL
   function, executable only by service_role, and cannot write or fetch Yahoo.
   Non-subscribers get no quotes. The Edge Function still calls Auth `getUser`
   first and checks the current subscription on every GET. Per-request state is
   isolated; no user identity, subscription decision, or price response is cached.
2. Pro OPTIONS responses advertise `Access-Control-Max-Age: 3600`. Browsers can
   reuse CORS permission instead of sending a preflight on every minute poll.
   GET responses remain `private, no-store` and enforce the same auth checks.
   The shared frontend fetch helper uses `cache: 'default'` so Chromium can keep
   its preflight cache. The previous request-side `no-store` also disabled that
   permission cache. Server `private, no-store` still prevents price caching.
   Browser caps, URL changes, and manual/hostile callers can reduce the savings.
3. Yahoo success diagnostics are no longer emitted. Network/quote failures and
   overall updater failures are still logged, without URLs or credentials.

The existing minute schedule, atomic refresh gate, eight-HTTP-request budget,
two-minute snapshot expiry, ratios, contracts, UI, and polling interval are
unchanged. News, options, billing, analytics, and frontend display logic are
untouched; only the shared Pro helper's HTTP cache option changed.

This removes one gateway request per successful Pro GET, avoids many repeated
preflights, and removes normal Yahoo console entries. Platform logs continue;
this is not a guarantee of a 1 GB monthly ceiling under arbitrary traffic.
For a full 30-day cycle, 1 GB corresponds to about 33 MB/day. Compare the Usage
page's daily ingestion over representative days, allowing its hourly reporting
delay. Do not run log queries on a recurring schedule to measure the quota.

## Validation and deployment

- 33 Deno tests passed, including current subscription revocation, concurrent
  request isolation, malformed/stale snapshots, and unchanged Yahoo limits.
- 11 PostgreSQL/PGlite tests passed, including actual RPC permissions and existing
  refresh/scheduler invariants. Both function entrypoints passed `deno check`.
- Applied the read RPC first. A live read using `SET LOCAL ROLE service_role`
  compared all 61 profiles against the original subscription/cache tables:
  subscription and quote-access decisions matched; anon/authenticated cannot call.
- Deployed the public Pro function and private updater through Supabase's editor.
  Public gateway JWT remains off with handler authorization; private gateway JWT
  remains on with the existing exact service-role check.
- Live public OPTIONS returned 204 with max-age 3600; unauthenticated GET was 401.
- Observed three automatic updater POSTs and three real subscriber GETs returning
  200 after backend deployment, with three combined read RPCs instead of separate
  profile/cache reads. No Yahoo success messages or Pro errors in that sample.
- At 22:57:16 UTC, the latest snapshot was fetched at 22:57:02 (14 seconds old)
  with exactly one active minute schedule.
- Five existing frontend tests passed. An actual browser test loaded the shared
  helper against a local CORS mock: two calls with original request `no-store`
  made two OPTIONS and two GETs; default mode made one OPTIONS and two GETs.
  Both GETs returned distinct server sequence numbers with response `no-store`,
  proving the optimization reuses permission without serving cached prices.

## Rollback of this optimization only

Redeploy `get-live-price-pro` and `refresh-pro-prices` from the pre-optimization
revision `3677a33` and restore `docs/pro_prices_api.js` from that revision. Leave
the existing Pro schedule and snapshot in place. The
new private read RPC can remain unused; no deletion is necessary. This rollback
keeps the September 27 shared-cache protection. Do not confuse it with reverting
that earlier architecture to request-driven Yahoo fetching.
