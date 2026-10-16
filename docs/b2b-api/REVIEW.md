# SpyConverter B2B verification — 2026-10-16

## Deployed and verified

The B2B backend uses real Supabase authentication, private organizations and billing records, exact shared PostgreSQL quotas, a Cloudflare API gateway, and separate live Stripe products, prices, Customer Portal and signature-verified webhook. Google signup requires no Supabase confirmation email; existing password login remains available without changing shared Auth settings.

New subscriptions use versioned Terms acceptance instead of DocuSign. The checkbox starts unchecked. The server records the authenticated owner, organization, verified email, immutable version/document SHA-256, timestamp and request evidence. Forged identities, timestamps, approval flags, stale documents, cross-organization requests and unchecked submissions are rejected. Historical signature records are preserved. Business still requires manual approval.

All three fresh Stripe sandbox checkouts passed the complete hosted sequence: real Supabase identity → server-recorded Terms → Business approval where required → hosted Stripe TEST payment → signature-verified webhook → correct paid entitlement → automatic one-time API key → authenticated synthetic conversion response → usage counter → Customer Portal. No real-money charge was made. See hosted-terms-flow.json.

The dedicated live Stripe webhook is Active, listens to nine lifecycle events and is isolated from SpyConverter Pro. The restricted application credential intentionally cannot manage webhooks. Live products are exactly B2B API $25, B2B API $50 and B2B API $150, with monthly USD prices.

The approved API-only Cloudflare upstream User-Agent rule fixes Python urllib error 1010. Default urllib now receives HTTP 401 JSON without a key; direct origin machine access receives 403; a forged Stripe signature receives 400. The five original website WAF rules were not changed.

## Tests

| Validation | Result |
| --- | --- |
| Current B2B backend suite | 10 tests / 45 steps passed |
| Current frontend DOM suite | 8 passed |
| Production Edge type checks | Three B2B functions passed |
| Existing website regression suite | 49 Deno tests / 12 steps; 66 Node regressions plus 20 SQL tests passed |
| Real hosted Terms/payment/key flow | Developer, Pro, Business all passed |
| Real hosted concurrent limits | Developer 10/20 allowed; Pro 30/40; Business 120/130; others JSON 429 |
| Real Stripe test-clock lifecycle | Renewal, failed payment and scheduled cancellation verified |
| Key security | Hash-only storage, one-time display, rotation/revocation, organization isolation |
| Launch restrictions | Unapproved Terms, unchecked acceptance and restricted data fail closed |
| Original tracked files | 276/283 unchanged; seven explicitly authorized website-security changes; no unexpected changes |
| Original production functions | Original functions preserved except the authorized Pro human-verification guard in contact-for-licencing; B2B secret changes increment project-wide runtime versions |

## Zero additional upstream requests

The private copier now runs once per minute, ten seconds after the unchanged minute-boundary updater. It only SELECTs existing database snapshots and writes the private B2B cache. It cannot call Yahoo, the original HTTP endpoint or an updater. All original cron commands and schedules are unchanged.

The production monitoring sample recorded 13 successful copies, zero failures, a source age of 44.5 seconds, five private snapshot variants and no API server errors. Snapshots are explicitly pending_review, so they cannot be served commercially. The source freshness limit remains 120 seconds. Customers receive the stored JSON text verbatim; metadata is carried in headers.

The instrumented synthetic comparison exercised 600 customer requests with the same three updater ticks. Baseline and loaded runs both made three quote batches and nine simulated Yahoo HTTP calls: **zero additional Yahoo requests**. Actual external network access was disabled. Source snapshot updates are reflected after copying, and customers share the same snapshots.

## Commercial activation status

Commercial checkout and live-data delivery remain disabled. The current Terms version is 2026-10-16-v1, SHA-256 9ed08e7617aff2e3f26dda2914cbd37d84622695f0b4ad9f58e313909669570b. The owner approved this exact Terms version on October 16; immutable catalog approval and the production Terms-acceptance flag are now active. Confirmed upstream redistribution rights and final activation approval are still required.

Capacity review measured approximately 129 MB database usage and under 1 MB of B2B tables. Supabase Free and Workers Free cannot support a fully used Business allocation plus existing traffic. The owner explicitly chose to keep Free plans on October 16. No upgrade was purchased. Sufficient commercial capacity, backups/restore validation and alert routing remain unresolved; quotas and advertised prices were not reduced. See COSTS.md and RUNBOOK.md.

Website Pro human verification is deployed and enabled after exact static-asset verification. Hosted atomic controls admitted 30 of 70 requests, challenged 40 and kept a second user independent. Direct Supabase cache reads and forged verification were denied. The five existing WAF rules, source updater and Mac ingestion remain unchanged. Production CAPTCHA completion itself remains a manual QA check; all token-validation cases passed with mocks.

The legacy Google Cloud reference is outside the active backend scope. No Google changes were made and investigation stopped. Existing manual Free ratios and source references remain untouched. No new Free-page 10/minute human challenge was installed: the current Free pages do not expose a live Supabase price feed, and Free WAF rate-limit features do not provide that exact one-minute challenge workflow. See WEBSITE-SECURITY.md.
