# SpyConverter B2B implementation verification

Updated 2026-10-16. The user authorized production infrastructure, GitHub push and deployment. Existing website integration remains additive: all 283 original tracked files match production baseline `1201ef5d9ac7ad2f3633690e8893d20e1793184b`, including three inherited production changes made after the initial local review.

## Actual deployed work

- Cloudflare Pages advanced-mode API gateway and new `api.spyconverter.com` hostname. Public DNS/TLS verified; cURL and Python Requests receive HTTP 401 JSON without a key. Python urllib's default user agent still receives an upstream Cloudflare 1010 response; see the limitation below.
- Private Supabase B2B schema, least-privilege database roles, real authentication/organization APIs, usage/key/subscription RPCs, production signing adapter and disabled SELECT-only cache copier.
- Exact live Stripe products `B2B API $25`, `B2B API $50`, `B2B API $150`; separate monthly prices, approved restricted credential, dedicated Customer Portal and signature-verified webhook. See RUNBOOK.md for IDs.
- A separate restricted hosted integration harness exercised real Supabase identity/storage, Stripe TEST Checkout/webhooks/test clocks and synthetic data only. It is now disabled after verification.

All five website routes are live under `/B2B/api/` and returned HTTP 200, including `/B2B/api/dashboard/?checkout=complete`. GitHub Pages deployment [38938686442](https://github.com/andyno30/SPX-SPY-Converter/actions/runs/38938686442) succeeded for website commit `fe024de1885be9ec4d87edb93df2b101fba71d8d`. Production paid checkout and live-data delivery are still disabled. A live signing account/template and approved agreement have not been configured; no synthetic signature can activate production.

## Verified tests

| Check | Evidence |
| --- | --- |
| Existing Deno regressions | 46 passed, zero failures |
| Existing Node regressions | 53 passed, zero failures |
| B2B functional suite | 8 tests / 39 steps passed |
| Signing recovery and canonical refunds | 2 tests / 18 steps passed |
| Exact production SQL driver | JSONB object/nested-value and reserved-connection regression passed |
| Frontend DOM tests | 6 passed; checkout confirmation covers unauthenticated, pending, verified, test-mode and cancelled states |
| Real Supabase authentication | Two disposable users signed in; owner dashboard 200; unrelated organization 403; invalid session 401 |
| Real hosted Stripe Developer test Checkout | Sandbox payment succeeded; verified webhook activated Developer entitlement; initial API key provisioned automatically; second provisioning did not create another key |
| Real hosted concurrent API requests | Developer: 10 allowed / 10 rejected; Pro: 30 allowed / 10 rejected; Business: 120 allowed / 10 rejected. Rejections HTTP 429; successful bodies identical |
| Real test Customer Portal | Session opened; invoice/payment-method controls present; cancellation recorded at period end with access retained |
| Real Stripe test-clock lifecycle | Successful renewal advanced billing period; failed payment changed entitlement to past_due; period-end termination changed it to canceled |
| Live webhook signature rejection | Production endpoint returns HTTP 400 / invalid_signature for a forged request |
| Business approval gate | Authenticated checkout rejected before manual review; test Checkout created only after operator approval |
| Production responsive review | All five routes captured at 1366px desktop and 390px mobile; no horizontal page overflow |
| Original homepage | HTTP 200; downloaded HTML byte-identical to the saved baseline |
| Original-file preservation | 283 unchanged; no original navigation, styling, Pro billing, updater or auth code changes |

The first hosted tests found two issues that local mocks did not expose: postgres.js double-encoded JSONB inputs, and the new role's connection cap was smaller than the transaction pooler's pool. Both were fixed and verified against real infrastructure. Queries reserve a connection to prevent unsafe pipelining; the B2B-only backend login cap is 20. Existing global database settings are unchanged.

## Zero additional Yahoo evidence

The instrumented synthetic comparison used the same three updater ticks for both runs:

| Counter | Baseline | 600 customer requests |
| --- | ---: | ---: |
| Existing quote batches | 3 | 3 |
| Existing Yahoo HTTP budget | 9 | 9 |
| Shared snapshot reads/copies | 3 | 3 |
| Additional Yahoo HTTP calls | 0 | 0 |

Actual network access was disabled in that test. The hosted Stripe/API tests use synthetic snapshots and never invoke the original market-data endpoint, updater or Yahoo. Source-copy is disabled and has no active schedule. This proves zero additional upstream calls for the exercised paths; it is not a claim that live market-data delivery is active.

The JSON parity test imports the unchanged production serializer, compares it with the downloaded deployed v3 serializer and checks nulls, missing prices, contract selection and date boundaries. The customer endpoint returns stored body text verbatim. Original-source age over 120 seconds produces 503; stale data is never silently presented as current.

## Remaining before commercial activation

- The user-approved Browser Integrity Check exception is deployed and active only for `api.spyconverter.com/v1/*` (rule `791fdc8cb0bb453d96df92fcbf6c9ce3`). Default `Python-urllib/3.13` still receives HTTP 403 / Cloudflare 1010 on both the custom hostname and the underlying Pages hostname. Python Requests and cURL receive JSON 401. This indicates an additional Pages-level check, but its exact cause is not yet established. The Cloudflare dashboard subsequently returned `error.internal_issues`, preventing further inspection. Resolve and retest this compatibility issue before claiming all machine clients receive JSON. Existing website security rules were not changed.
- Configure the real signing provider account, JWT consent and approved versioned agreement template. Current draft/provider configuration cannot complete a production signature.
- Hosted sandbox checks passed for all three paid tiers and automatic keys; renewal, failed payment and termination webhooks were verified. All five published pages were also inspected in desktop and mobile views.
- Website publication succeeded. The actual production dashboard recognizes the existing Supabase session; customer data remains scoped to that user. Checkout return parameters never prove payment; unrelated account/organization returns show an explicit account mismatch.
- Activate the controlled DB-copy path only with its documented provenance configuration; preserve the source schedule and request budget.
- Review Free-plan hosting capacity, monitoring, usage-record retention and backups. No paid hosting upgrade was purchased.
- B2C human verification remains separate. The Free endpoint is hosted on App Engine with source absent from this repository. Root-domain Cloudflare challenges cannot protect its direct URL. Do not represent B2B JSON limiting as B2C protection.

No real-money test charge has been made. Existing Stripe Pro products, webhook, subscriptions and authentication configuration remain unchanged.
