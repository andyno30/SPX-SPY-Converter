# Spyconverter Pro ES contract selection — review before deployment

Prepared September 14, 2026. This is the pre-deployment review. The user subsequently approved deployment; the release is now live. See [deployment status](deployment.md) for production verification and the remaining signed-in account check. Historical pending-deployment statements below describe the review state.

## Inspection findings

The complete deployed `get-live-price-pro` (version 29, last updated April 25, 2026) was downloaded into a temporary folder and compared with the repository. It matches, apart from its final newline. It uses `yahoo-finance2` to batch twelve Yahoo Finance quotes, including **`ES=F`**. Prices and requests are cached/deduplicated for 60 seconds per warm Edge instance.

`ES=F` is Yahoo's rolling/front-month alias, not an explicit expiration or a guarantee of the most liquid contract. During inspection Yahoo identified it as **September 2026**, expiring September 18, 2026; its price matched `ESU26.CME`. December was independently available at a different price. Auto preserves this provider-controlled symbol and reports the underlying expiration from Yahoo's metadata. There is no internally invented rollover calendar or volume-based switch. See [Yahoo ES](https://finance.yahoo.com/quote/ES%3DF/) and the [provider library](https://github.com/gadicc/yahoo-finance2).

Individual Yahoo contracts use `ES` + quarterly month code (`H`, `M`, `U`, `Z`) + two-digit year + `.CME`. The table below is from an actual Deno probe using the implementation's pinned `yahoo-finance2@4.0.2` and conversion code at **2026-09-14 13:35:08 UTC**. These are recorded observations, not current prices.

| Choice | Yahoo symbol | Price | Quote timestamp (UTC) | Selector |
| --- | --- | ---: | --- | --- |
| Auto / Front Month | `ES=F` (reported ESU26) | 7607.25 | Sep 14, 13:25:07 | Default |
| September 2026 (ESU26) | `ESU26.CME` | 7607.25 | Sep 14, 13:25:07 | Included |
| December 2026 (ESZ26) | `ESZ26.CME` | 7674.25 | Sep 14, 13:25:07 | Included |
| March 2027 (ESH27) | `ESH27.CME` | 7763.50 | Sep 14, 11:36:29 | Included |
| June 2027 (ESM27) | `ESM27.CME` | 7887.75 | Sep 10, 19:50:00 | Included |
| September 2027 (ESU27) | `ESU27.CME` | 7971.00 | Sep 3, 15:33:55 | Included |
| December 2027 (ESZ27) | `ESZ27.CME` candidate | No quote | No data | Excluded |

Yahoo reported a **10-minute delay**. Thinly traded expirations can have much older last trades. The UI displays the selected contract, price, last-trade timestamp and provider delay; refreshing does not imply a new trade. December 2027 was absent from the quote batch and its chart request independently returned `Not Found`. It must be verified before being added.

[Recorded provider results](provider-verification.json) include both calculated ES ratios: December returned ES/SPY 10.11526598829546 and ES/SPX 1.0099105927932055, versus March's 10.232904518374019 and 1.021655651972512.

## Security findings and enforcement

An unauthenticated GET to production returned HTTP 200 and all prices. Both deployed code and `supabase/config.toml` have no gateway JWT enforcement; the function also has no application authorization. Its three frontend callers fetch without Authorization. Page-level subscription gates alone do not protect the data.

A read-only database catalog query additionally found:

- `public.profiles` has RLS enabled and own-row SELECT/UPDATE policies.
- `profiles_update_own` checks only `auth.uid() = id`.
- The authenticated role has UPDATE permission on `is_subscribed`.
- There were no protective triggers on that table.
- INSERT is limited by policy to `service_role`.

Therefore, checking the existing subscription flag is only reliable after preventing users from changing it. The prepared SQL trigger blocks browser roles from changing `id`, `is_subscribed`, `subscription_id`, or `stripe_customer_id`. Own-row reads, other profile edits, and service-role billing writes remain compatible. It does not modify existing subscriber rows or billing workflows.

The new handler requires a Bearer token on **every GET**, including Auto and cache hits. Supabase `auth.getUser(token)` validates the user, anonymous users are rejected, and a server-side lookup requires `profiles.is_subscribed === true` for that verified user ID. Invalid/missing sessions return 401, non-Pro users return 403, and authorization lookup failures fail closed. No entitlement is accepted from URL parameters, localStorage, or user-editable auth metadata.

`verify_jwt = false` stays as-is because the function itself validates the session with Supabase Auth, preserving current signing-key compatibility. CORS preflight is public, but returns no prices. HTTP responses use `Cache-Control: private, no-store` and `Vary: Authorization`; the internal market snapshot is shared only after authorization. Environment variables follow the existing `PROJECT_URL` / `SERVICE_ROLE_KEY` convention with standard Supabase variable fallbacks. No secrets enter the frontend.

## Implementation and compatibility

The endpoint accepts omitted `esContract` / `esContract=AUTO` or a code from a literal server-side allowlist. Unknown, malformed, duplicate, empty and unverified codes are rejected with 400 before Yahoo is called. Each refresh checks the quote symbol, FUTURE type, finite positive last price, quote timestamp, matching expiration, and non-expired provider expiration date. Unsupported contracts are omitted from the returned choices. An unavailable selected contract returns 503; it never falls back to Auto or another expiration.

One Yahoo batch contains the original twelve symbols plus five verified expirations. One 60-second in-memory snapshot and one in-flight promise are shared across contract choices per warm instance. Switching within the cache window adds no upstream call. Existing cross-instance cache/rate-limit characteristics are unchanged; this is not a global cache across Supabase instances.

Responses preserve `Prices.ES`, all original instruments, all existing ratio field names and `Datetime`. They add `ESSelection`, `ESContract`, `ESSymbol`, `ESQuote` metadata and `ESContracts`. The selected ES price supplies both ES/SPY and ES/SPX. The generic response schema remains compatible, while unauthenticated access is intentionally closed.

On the frontend, changing the selector clears the previous ES price/ratios, ignores late responses for older selections, then immediately recalculates ES conversions in both directions. Contract-only responses update only ES; existing SPX/SPY/Nasdaq values and selected From/To controls are preserved. Periodic refresh still runs every 60 seconds. Auto is the default on each page load. The old unscoped `liveRatios` localStorage cache is no longer read, preventing cross-contract stale ratios. A frontend-first rollout can still display an old Auto payload without exposing explicit choices.

The only ES consumer is `docs/pro_script.js`, covering ES ↔ SPY and ES ↔ SPX, ratio displays and its price-display helper. The Dow/Russell converter consumes other `Prices` fields; the overlap chart consumes only SPX/SPY. Their only functional change is using the shared authenticated request helper so securing the endpoint does not break them. Existing login and page subscription gates remain unchanged. Session expiration is handled by the existing Supabase client plus one refresh/retry after 401.

## Files changed for this feature

Frontend:

- `docs/premium-feature.html`: selector, status text, module script and scoped page class.
- `docs/pro_script.js`: contract-aware fetching, displays, race handling, ES recalculation.
- `docs/pro_styles.css`: selector styling and mobile sizing scoped to the ES converter page. Browser checks revealed existing mobile header overlap and footer/input overflow; the scoped fixes keep the new selector and controls readable without changing the other converter.
- `docs/pro_prices_api.js` (new): shared session-bearing request/refresh helper.
- `docs/dow_russell_script.js`, `docs/dow-russell-feature.html`, `docs/spx-spy-overlap-chart.html`: minimal authenticated-request integration.

Backend:

- `supabase/functions/get-live-price-pro/index.ts`: Yahoo/Supabase adapters and handler wiring. Yahoo dependency pinned at tested 4.0.2 instead of leaving the existing unversioned import to drift.
- `supabase/functions/get-live-price-pro/pricing.ts` (new): allowlist, validation, response mapping and cache.
- `supabase/functions/get-live-price-pro/authorization.ts` (new): verified-user subscription decision.
- `supabase/functions/get-live-price-pro/handler.ts` (new): methods, authorization, validation and responses.
- `supabase/config.toml`: explanatory comments only; no configuration value changes.
- `supabase/sql/pro_price_authorization.sql` (new, **not applied**): subscription-field safeguard.

Validation and review:

- `tests/pro_prices_test.ts`, `tests/pro_frontend_test.cjs`, `tests/pro_billing_test.cjs`.
- `scripts/probe_es_contracts.ts` and this review folder.

No free converter, Stripe code, pricing plans, SEO, ads, production settings, or unrelated feature was changed. Pre-existing news edits and their test/SQL files were preserved.

## Validation results and limits

- **9 backend tests passed**: Auto, independent December/March mapping, both ES ratios, unchanged unrelated instruments, strict allowlist, missing/expired/wrong contracts, cache freshness/deduplication/failure recovery, verified identity, non-Pro/invalid/unauthenticated rejection including warm-cache access, fail-closed database errors.
- **5 frontend tests passed**: automatic ES recalculation, preservation of other instruments and To selection, rapid switching/late response rejection, missing/mismatched quote handling, periodic refresh and old Auto payload compatibility, session headers/refresh/login and non-Pro redirects.
- **1 PostgreSQL safeguard test passed** using PGlite: self-upgrade and billing-ID edits rejected, normal profile edits preserved, service-role activation/cancellation preserved, SQL safely re-applies.
- Deno 2 type-check of the complete Edge Function passed.
- Actual Yahoo quote retrieval succeeded under both Node and Deno; the Deno probe used the production mapping/ratio functions.
- Browser fixture tests passed for Auto → December → March, ES/SPY and ES/SPX conversion, Dow/Russell conversion, and the overlap chart. Desktop and 390px/320px mobile inspected; no horizontal overflow after the scoped fix.
- Existing `node scripts/test_news_dates.cjs`: **4 passed**.
- Existing `news-app` production build: **passed**, including lint and type checking.
- `git diff --check`: passed.

The initial checks exposed test harness/type integration issues; these were fixed and rerun successfully. No remaining test/build failure is known.

The browser preview used isolated fixture users and prices. Token validation/subscription decisions were tested with controlled dependencies; the database migration was tested locally, not in production. An actual paid-user/free-user sign-in against the newly deployed handler has **not** been exercised because deployment is intentionally pending. No existing user's subscription or credentials were changed for testing. A real signed-in Pro/non-Pro smoke test is required during the reviewed release process before treating the production release as verified.

## Reproduce and release after review

Requires Deno 2 and Node 22+ (Node 24 used for the frontend/database tests). Tests use temporary dependencies; no new dependency was added to the news app.

```sh
deno check --no-lock --node-modules-dir=none supabase/functions/get-live-price-pro/index.ts
deno test --no-lock --node-modules-dir=none tests/pro_prices_test.ts
npm install --prefix /tmp/spyconverter-es-tests happy-dom@20 @electric-sql/pglite@0.3.15
NODE_PATH=/tmp/spyconverter-es-tests/node_modules node --test tests/pro_frontend_test.cjs tests/pro_billing_test.cjs
deno run --no-lock --node-modules-dir=none --allow-net --allow-env --allow-read scripts/probe_es_contracts.ts
node scripts/test_news_dates.cjs
```

Run `npm run build` from `news-app` for its existing production build.

After approval: apply the SQL safeguard, release the session-bearing frontend to all three callers, verify existing login/Auto, then release the Edge Function with its required service-role environment. Complete real Pro/non-Pro/expired-session and direct unauthenticated checks. Previously open old browser tabs may need one reload because their cached scripts do not send tokens. Do not restore public access as a compatibility workaround.

Maintenance: rerun the provider probe before adding a future contract to `ES_CONTRACTS`. Confirm matching Yahoo symbol/expiration and usable last trade before adding its human label. Expired entries disappear from available choices automatically using provider metadata; remove them from the literal allowlist during routine updates to avoid unnecessary quotes. Auto continues working via `ES=F` even when all explicit entries age out.
