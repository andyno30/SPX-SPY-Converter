# Pro price refresh requirements

Status: deployment authorized on 2026-09-27 after clarifying that this protects
Yahoo usage and does not make unlimited incoming traffic harmless or free.
Commit/push message requested by the user: `9/27/26 api limit rate update`.

October 2 follow-up: ingestion optimization combines the two private database
reads, removes routine Yahoo success logs, and enables preflight reuse. The
shared frontend helper's HTTP cache mode changes, while server price responses
remain `private, no-store`; UI, price freshness rules, and auth are unchanged.
See [the follow-up record](pro-prices-log-ingestion.md).

Agreed scope: 2026-09-27. Change only Supabase Pro price acquisition/delivery.

- Keep every website file, UI, feature, ratio, ES contract selection, response
  field, browser refresh interval, and authentication/subscription check intact.
- Do not change news, options, public App Engine converters, billing, accounts,
  Google Analytics, or domain/DNS settings.
- Do not add account/IP daily quotas or licensing popups.
- Visitor Pro GETs must never call Yahoo, including cold/stale/missing caches.
- A private updater fetches the same 17 Yahoo symbols once per scheduled minute
  into a shared private database snapshot. All updater instances share an atomic
  attempt gate; retries and duplicates cannot bypass it.
- Preserve the existing 503 response/error handling when the shared snapshot is
  missing, malformed, or over two minutes old. The user selected this rule rather
  than indefinite stale delivery. Allow five seconds of DB/worker clock skew.
- Leave the existing frontend failure behavior intact: ES values become
  unavailable; prior non-ES values and the prior displayed timestamp may remain.
- The new guarantee covers Yahoo calls caused by Pro GETs, not zero Supabase
  processing/bandwidth or unbounded protection against incoming request floods.

## Operation

The protected `refresh-pro-prices` POST endpoint is called by Supabase Cron.
Only the existing project service-role credential authorizes it; the credential
is never sent to browsers. Its database RPC claims one UTC minute bucket and a
90-second lease before contacting Yahoo. Claim tokens fence completion/release
so late workers cannot replace a newer snapshot. Failures retain the attempted
minute, and there is no visitor-triggered retry or Yahoo fallback.

`get-live-price-pro` still verifies the real user and `profiles.is_subscribed`
on every GET. Since October 2, one service-role-only read RPC returns the current
subscription and snapshot together, with no quote data for non-subscribers.
Cache tables/RPCs are inaccessible to anonymous and authenticated browser roles.
Quotes remain shared server-side only. See [ingestion reduction](pro-prices-log-ingestion.md).

No frontend deployment is needed. A snapshot must be populated and the scheduler
verified before switching the public Pro function to cache-only delivery.

The schedule runs every minute, including periods without visitors. It admits at
most 1,440 quote-refresh attempts per UTC day. Each attempt requests the existing
17-symbol list once, with a 30-second deadline and an eight-request budget that
also counts Yahoo session/consent/crumb traffic. This is a fixed upstream bound,
not a claim that the number of HTTP requests always equals the number of refreshes.
Failed attempts are not retried until a later minute. Consent flows exceeding the
budget fail closed. Safe failure logs exclude URLs and credentials. Successful
Yahoo HTTP request diagnostics were removed on October 2 to reduce ingestion.

The browser's unchanged polling timer and the scheduler are independent. A poll
just before a refresh completes can receive the preceding snapshot. No deliberate
response delay is introduced, but identical price freshness/latency is not promised.

## Deployment record

Deployed to project `isvzhpqrmjtqnqyyidxr` on September 27, 2026 (Pacific time;
September 28 UTC). Both SQL files were applied, and the existing service-role key
was saved in the same project's encrypted Vault with the user's explicit approval.
The credential is absent from source and the stored cron command.

- `refresh-pro-prices` deployed with gateway JWT verification enabled and its
  additional exact service-role authorization check.
- Initial authenticated refresh returned 200 and populated the cache before the
  public cutover. Yahoo returned 16 available quotes from the unchanged 17 symbols.
- Cron job 6, `pro_price_refresh_every_minute`, ran automatically at 00:03 and
  00:04 UTC; successful snapshots completed about three seconds after each minute.
- Six concurrent duplicate updater calls returned 204; the snapshot timestamp and
  attempted-minute marker were unchanged.
- `get-live-price-pro` deployed with the existing gateway setting retained
  (`verify_jwt = false`); its existing user/subscription checks remain in the handler.
- Unauthenticated public and updater requests returned 401.
- News jobs 1, 3, 4, and 5 retained their schedules and active status.

Validation: 30 Pro unit tests, five frontend tests, one billing security test,
nine database behavior tests, and both function entrypoint typechecks passed.
Additional offline checks exercised the actual pinned Yahoo library's cold/warm
sessions, consent flow, body-read timeout, and updater authorization. The SQL tests
use isolated PGlite; cron/network/Vault integrations there are recording stubs.

The dashboard browser editor received single-file ESM bundles built from these
sources with Deno 2.7.12. Only local modules were bundled; npm dependencies remained
external. These commands reproduce the deployment artifacts:

```sh
deno bundle --node-modules-dir=none --external=npm:yahoo-finance2@4.0.2 --external=npm:@supabase/supabase-js@2 --external=node:crypto --no-lock supabase/functions/refresh-pro-prices/index.ts -o /tmp/refresh-pro-prices.js
deno bundle --node-modules-dir=none --external=npm:@supabase/supabase-js@2 --no-lock supabase/functions/get-live-price-pro/index.ts -o /tmp/get-live-price-pro.js
```

For rollback, redeploy `get-live-price-pro` from the parent revision
`fb488646473584c966afa4de7db33f9533a36d50`, then unschedule only the named Pro job.
The prior version resumes request-driven Yahoo fetching. Leave the private cache
and Vault entry in place until no longer needed; no other function or job is part
of this rollback.
