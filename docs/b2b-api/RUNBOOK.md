# SpyConverter B2B operations

Production infrastructure changes and website publication were authorized in the current task. This document supersedes the earlier local-only runbook. Never treat it as permission to charge a real payment in a test.

## Deployed components

- Cloudflare Pages advanced-mode project `spyconverter-b2b-api` serves `gateway-worker.mjs` as `_worker.js`, with `_routes.json` including `/*`. This is the API gateway only; the original website remains GitHub Pages.
- New hostname `api.spyconverter.com` points to that project. The gateway holds only encrypted `B2B_GATEWAY_SECRET`, forwards to the fixed Supabase B2B function, strips cookies, and returns JSON on upstream errors. The gateway never generates CAPTCHA. The user-approved Browser Integrity Check exception is active only for `api.spyconverter.com/v1/*`, rule `791fdc8cb0bb453d96df92fcbf6c9ce3`. The approved request-header rule `cfb6660d833a4da4b9eab1a463337142` sets upstream User-Agent to `SpyConverter-B2B-Gateway/1.0` on that same API-only path. Default Python urllib, Requests and cURL now receive JSON 401 rather than Cloudflare 1010. The five original website WAF rules remain unchanged.
- Supabase project `isvzhpqrmjtqnqyyidxr`: new private `b2b_private` schema; `b2b-platform`, `b2b-cache-copy`, and temporary restricted `b2b-platform-test` functions. Existing authentication settings and updater schedules are unchanged. The separately authorized Pro website-security guard extends contact-for-licencing; see WEBSITE-SECURITY.md.
- Three new restricted database logins have only their respective B2B RPC permissions. The backend uses the existing transaction pooler on port 6543, with prepared statements disabled and one outstanding query per reserved connection. Its connection cap is 20 to accommodate the pooler's pool; source and writer caps are 12. No global database setting was changed.
- The five website routes are published as additive directory indexes under `/B2B/api/`. The checkout return URL is a confirmation view; signed-out users must sign in and an unrelated account cannot see payment confirmation. No links are added to existing navigation, footer, converters or Pro.

## Current activation state

Customer accounts and applications use real Supabase authentication and storage. Live Stripe products, prices, restricted server credential, dedicated portal and signed webhook are configured. Paid Checkout and owner-authorized live-data delivery are enabled following the owner’s explicit final activation instruction. The owner is handling licensing separately; independent licensing verification is not represented. Free-plan capacity and backup limits remain documented. The owner approved exact Terms version `2026-10-16-v1` on October 16; acceptance is enabled. DocuSign is no longer required for new customers. Do not claim commercial activation from product creation or a browser redirect.

The production flags `B2B_API_STRIPE_LIVE_ENABLED`, `B2B_API_LIVE_MARKET_DATA_ENABLED` and `B2B_API_OWNER_DELIVERY_AUTHORIZED` are true. The matching owner reference is `owner-activation-2026-10-16-codex`. `B2B_API_DATA_LICENSE_APPROVED` remains false. `B2B_API_LEGAL_APPROVED=true` records the exact owner-approved Terms. Private cache copying is enabled: cron job 7, `b2b_cache_copy_every_minute`, runs once per minute, with a 10-second copy-only offset after the unchanged source updater. Current snapshots carry matching `owner_authorized` provenance. Unapproved `pending_review` snapshots cannot be served to customers. The temporary integration harness accepts only designated disposable users, the private gateway secret, Stripe test credentials, and synthetic snapshots. `B2B_TEST_ENABLED=false` and its dedicated Stripe test webhook are now disabled after verification; test artifacts remain for audit.

## Exact live Stripe configuration

| Product name | Product ID | Monthly USD price ID |
| --- | --- | --- |
| B2B API $25 | prod_VS7ivkxtizz7Vv | price_1URDSj2mY7zktgIWMD0TwY5r |
| B2B API $50 | prod_VS7iqQlig25uaf | price_1URDTO2mY7zktgIWgqhl0vpM |
| B2B API $150 | prod_VS7kvYzr7mpOBf | price_1URDUa2mY7zktgIWE5unv5go |

Live portal configuration: `bpc_1URDxt2mY7zktgIWCk090Hv0`. Invoice history, payment-method updates and cancellation at period end are enabled. Automatic plan switching is disabled to preserve Business approval. Upgrades enter an audited review queue.

Live webhook: `we_1URE3O2mY7zktgIWE2Eb0vpS`, URL `https://isvzhpqrmjtqnqyyidxr.supabase.co/functions/v1/b2b-platform/webhooks/stripe`. It listens to checkout completion, invoice paid/failed, subscription created/updated/deleted, refund, and dispute created/closed. Its snapshot version is the existing account version `2022-11-15`; canonical API reads use pinned `2024-06-20`. Account-wide API settings and existing Pro webhook are unchanged.

The handler verifies raw-body signatures within five minutes, fetches canonical Stripe state, checks exact price/quantity/currency/monthly interval and a paid invoice covering the billing period, then serializes reconciliation per organization. Duplicate events are idempotent; stale snapshots cannot grant access. Failed payments revoke access without an unpaid grace period. Scheduled cancellation preserves access through the paid period. Refunds/disputes suspend access until operator review. No overage charges exist.

Checkout returns to the published dashboard confirmation view. The return parameter cannot activate access; the view polls authenticated server state and shows payment confirmation only after verified paid entitlement.

Automatic initial-key provisioning is an authenticated owner operation triggered by the dashboard after verified activation. It is serialized per organization, creates one initial credential, stores only its hash and returns plaintext once. Lost browser delivery requires authenticated rotation; support must never email plaintext keys.

## Private configuration

All application settings in the deployed Edge adapter use the `B2B_` prefix. Never reuse existing Pro billing variables. Store values with the Supabase secret manager; do not put them in Git or chat.

| Variable | Purpose |
| --- | --- |
| B2B_API_ENVIRONMENT | `production`; the harness forcibly uses `test` |
| B2B_API_SITE_ORIGIN | `https://spyconverter.com` |
| B2B_SUPABASE_PUBLISHABLE_KEY | Existing public authentication key |
| B2B_DB_POOLER_URL | Verified shared transaction-pooler URL, without a password |
| B2B_DB_BACKEND_PASSWORD | Restricted customer/account RPC login |
| B2B_DB_SOURCE_PASSWORD | Restricted SELECT-only source-cache login |
| B2B_DB_WRITER_PASSWORD | Restricted private-cache publication login |
| B2B_API_KEY_PEPPER | Random server-only HMAC secret; changing it requires key rotation |
| B2B_GATEWAY_SECRET | Shared only between Cloudflare gateway and B2B origin |
| B2B_CACHE_COPY_SECRET | Authorizes internal copy invocation, never customers |
| B2B_STRIPE_SECRET_KEY | Approved restricted live credential, separate from Pro |
| B2B_STRIPE_API_PRICE_DEVELOPER / PRO / BUSINESS | Exact live price IDs above |
| B2B_STRIPE_API_PORTAL_CONFIGURATION | Dedicated portal ID |
| B2B_STRIPE_API_WEBHOOK_SECRET | Dedicated endpoint signing secret |
| B2B_API_STRIPE_LIVE_ENABLED | Checkout activation switch; enabled by owner on October 16 |
| B2B_API_LIVE_MARKET_DATA_ENABLED | Live-data kill switch; enabled by owner on October 16 |
| B2B_API_DATA_LICENSE_APPROVED / REFERENCE | Upstream provenance configuration; no legal verification is inferred from software ownership |
| B2B_API_OWNER_DELIVERY_AUTHORIZED / OWNER_AUTHORIZATION_REFERENCE | Explicit owner activation; distinct from verified licensing. Both required, production only. |
| B2B_API_CACHE_COPY_ENABLED | Allows SELECT-and-copy, never a price fetch |
| B2B_API_LEGAL_APPROVED / AGREEMENT_VERSION | Approved production agreement/version |
| Legacy B2B_DOCUSIGN_* variables | Historical workflow only; not used by new subscriptions |
| B2B_TEST_ENABLED / USER_IDS | Temporary harness switch and disposable-user allowlist |
| B2B_TEST_STRIPE_* | Separate Stripe test key, prices, webhook and portal |

The browser contains only the public API origin and publishable authentication configuration. Direct machine-origin requests require the private gateway header in addition to customer authentication. No service-role key is used by the application database adapter.

## Schema and Terms acceptance

Apply sources to a fresh environment in order: `b2b_api_setup.sql`, `b2b_api_review.sql`, `b2b_api_source_reader.sql`, `b2b_api_signing.sql`, then create restricted login memberships and secure credentials. Do not rerun create-table scripts over an existing deployment. Initial production migrations are recorded as `20261016160000`, `20261016163000`; follow-up recovery and pooler-cap migrations are `20261016170000`, `20261016171500`, `20261016174500`. The last migration permanently binds subscriptions to test or live billing; all pre-existing test fixtures remain test-only.

New acceptance uses an initially unchecked checkbox linked to the complete versioned Terms. The authenticated owner explicitly submits `accepted: true`, the version and digest. The API and database independently verify owner membership, a verified Supabase identity, immutable document digest and approval. The database supplies the identity and timestamp, stores an acceptance receipt and audit event, and atomically handles duplicates. Clients cannot supply their own approval, signing identity or acceptance date. Checkout and initial key provisioning require this receipt. Existing signature sessions, completed documents and audit records are preserved.

Migration `20261016190000` adds `b2b_api_terms.sql` and `b2b_api_operations.sql`, the immutable Terms catalog and the private copy schedule. The current catalog has `approved_at=2026-10-16 18:59:23.572747+00`, approved by the owner in Codex. `test_enabled=true` additionally authorizes disposable TEST organizations. Test acceptance cannot authorize a LIVE organization. Approval must identify the human reviewer and the exact document digest. Document source is `supabase/b2b-api/terms-document.json`; the full public copy is `/B2B/api/terms/terms.txt`.
Business review uses `b2b_api_review` with a named reviewer and matching application ID. The customer role cannot approve itself. Review credentials must remain unavailable to the customer gateway.

## Cache operations

`b2b-cache-copy` accepts authenticated POST only. It SELECTs the existing `pro_price_cache` through the read-only bridge and serializes with the unchanged production response builder. It has no HTTP path to Yahoo, yfinance, the original licensing endpoint, or the updater. Customer handlers cannot invoke it.

The separate minute-aligned database-copy invocation is active using a dedicated Vault secret. Do not edit the original `pro_price_refresh_every_minute` job. Do not create a market-data polling job. The copy's interval never depends on customer volume. Failed copies retain the last successful body, but serving rejects source age beyond 120 seconds; copy time cannot renew freshness.

## Verification and local review

The loopback simulator remains available for design review, clearly labeled synthetic. It loads no production secrets:

```sh
node tests/helpers/premium-quota-postgres-runtime.cjs start
deno run --no-lock --cached-only --no-check --allow-read --allow-write --allow-env --allow-net=127.0.0.1:8799 scripts/b2b-api/preview.ts
```

Open `http://127.0.0.1:8799/B2B/api/`. The fixture sign-in is `developer@example.test` / `local-demo-only`. Network permissions deny external providers; PostgreSQL is a temporary Unix-socket-only cluster.

Local regression tests cover quota races, signatures, cancellation, failures, null-preserving JSON parity, 120-second expiry, key rotation/revocation, organization isolation and disabled flags. The driver regression must run with the exact postgres.js version and a temporary dependency directory. Real hosted tests use separate Stripe test objects and disposable Supabase identities. They do not count as real-money live-mode charges.

## Rollback and remaining operational prerequisites

Disable B2B checkout, live delivery and copying first. Keep billing/signature/audit records. Remove only the new API custom domain/project route and B2B static pages if needed. Revoke only new B2B credentials after reconciling any paid customers. Never drop original auth/source/Pro objects or alter the original updater.

`b2b_api_rollback.sql` is destructive and is only for a separately reviewed B2B cleanup after export; never run it automatically on an error. Preserve all signed documents and Stripe records required by retention policy.

The owner explicitly authorized commercial activation and handles licensing separately. Owner-authorized live delivery and Checkout are enabled; provider licensing is not marked verified. Hosting capacity/backups remain operational limitations on the requested Free plans. Exact Terms are owner-approved. Keep Free plans as requested; do not silently reduce Business quotas or purchase capacity. The default-urllib issue is resolved and the controlled copy is active. Verify live-mode configuration without a real-money test charge. Hosted Stripe sandbox payment, provisioning, renewal, failure and cancellation checks have passed. The Pro website human-verification control is deployed and enabled; see WEBSITE-SECURITY.md. The legacy Google Cloud reference is not a deployment dependency. Preserve manual Free ratios, source references and the existing Mac/Supabase automation. Free calculation enforcement is deployed separately; see WEBSITE-SECURITY.md.

## Capacity, monitoring and backups

The October 16 read-only capacity sample measured approximately 129 MB total database size and under 1 MB of B2B tables before commercial traffic. This is current usage, not a capacity guarantee. Free Supabase includes 500,000 Edge invocations/month and 500 MB database; one Business quota plus cache-copy and existing website traffic exceeds the invocation allowance. Workers Free allows 100,000 requests/day, below one Business customer's possible 172,800 requests/day. Use Supabase Pro (from $25/month) and Workers Paid (from $5/month) before offering unrestricted paid-plan capacity. The owner explicitly chose to keep Free plans on October 16; no upgrade has been purchased. This does not resolve the capacity shortfall.

`select public.b2b_api_operations();` is operator-only and reports source age, private copy attempts/successes/failures, snapshot provenance, database/B2B bytes, recent API 5xx counts and active paid organizations. `b2b_private.cache_health` keeps one bounded status row. Cron job history and Edge logs show invocation failures; no keys, JWTs or raw provider data should be placed in application logs. Alert on repeated copy failures or no successful copy for 120 seconds during expected update windows, sustained API 5xx, failed Stripe event delivery, and 80% capacity. An external notification destination and managed daily backup coverage must be verified during paid-hosting activation; do not claim these are already enabled on Free.

The operator-only `b2b_api_prune_requests(90,10000)` permits bounded cleanup of request detail older than 90 days; it is not scheduled and has not deleted records. Billing counters, Stripe events, agreements, historical signatures and audit logs are preserved. Retention/legal review should set the final policy. Supabase Free does not include managed automatic backups. Managed backups and an encrypted private export/restore drill remain outstanding while the owner retains Free hosting. Never store database backups in Git or public website directories.

Rollback copying with `select cron.unschedule('b2b_cache_copy_every_minute');` and disable the B2B copy flag. Never unschedule `pro_price_refresh_every_minute`. Keep all Terms acceptance and billing evidence on rollback.

## October 16 owner activation and Free calculator

Apply b2b_api_owner_activation.sql after the existing B2B migrations. It adds a distinct owner authorization reference and preserves licensed/synthetic provenance constraints. The scheduled copy and customer API require matching mode/reference. The production authorization audit records the explicit owner instruction without declaring licensing verified.

Apply website_free_calculations.sql after website_human_verification.sql. Deploy website-free-calculations with gateway JWT verification off: the handler requires the private gateway secret and overwritten HMAC network identity. The new gateway route /v1/website/free-calculations accepts browser-origin POST only and never inherits B2B entitlements. Deploy gateway before the four Free page handler changes and free-calculations.js. Activate website_security.control.free_enabled only after tests. No shared Auth, WAF, DNS, updater or source changes are required.

Rollback Free limiting with free_enabled=false, retaining server calculation and original math. On an endpoint outage, revert the four Free page handler changes to restore the original local calculations; do not alter original ratio sources. Roll back B2B by setting B2B_API_STRIPE_LIVE_ENABLED=false and B2B_API_LIVE_MARKET_DATA_ENABLED=false; preserve paid customer, acceptance and audit records.
