# Website human verification — separate from the B2B API

The owner authorized backward-compatible Free/Pro human verification and protection against direct-origin bypass. The five existing Cloudflare website WAF rules remain unchanged. No B2B links were added to the original website.

## Pro implementation

The existing authenticated `contact-for-licencing` endpoint validates the existing Supabase identity and Pro subscription, then calls an atomic private `website_security` control. It asks for human verification above 30 admitted requests in a rolling minute. A successful server-verified Cloudflare Turnstile token grants five minutes of bounded clearance, still limited to 60/minute and the existing hard quotas. Three failed verification attempts lead to a five-minute block. Normal 60-second price polling remains unchanged. Authenticated-user identity binds the counter and challenge, so direct Supabase calls cannot evade it by changing IP or bypassing the website.

A dedicated Managed Turnstile widget, `SpyConverter website verification`, permits only spyconverter.com and has no pre-clearance. Public sitekey: 0x4AAAAAAFYuYWUcIqoM4vKc. Its secret is in Supabase's secret manager. The new `website-verification` Edge function validates identity, existing paid entitlement, exact origin, server-issued challenge, token hostname/action/cData, age and single-use result. Clients have no permission to write counters or claim verification directly. The UI loads Turnstile only when challenged and retries once after confirmed verification. Cancellation or identity changes grant nothing.

The verifier and limiter contain no market-data fetching capability. Successful price JSON remains byte-identical to the existing handler. Existing 120-second freshness checks, formulas, updater and hard quotas are untouched. Website code and verification never execute on B2B machine API paths; B2B continues returning JSON limits without CAPTCHA.

## Deployment state

The private schema and verifier are installed. The extended price endpoint is deployed. The new control is disabled until the frontend is published and checked. Record activation and hosted checks in the release evidence after that sequence.

SQL migration source: supabase/sql/website_human_verification.sql. New private rows contain only bounded timestamps, nonce and verification state for an existing auth user. No IP address, raw Turnstile token, JWT, payment detail or market data is retained. SQL tables are inaccessible to browser roles; only the service role can execute the controlled function. Historical billing and agreement records remain intact.

## Tests

49 Deno regressions / 12 steps passed; 66 Node regressions passed, followed by all 20 SQL tests using the required test dependency path. The initial full Node command had four dependency-loader failures (missing pglite); rerunning those four files with the correct NODE_PATH passed. Do not report the initial command as entirely successful.

Tests exercise concurrent 30/70 admission, independent users, nonce binding, rejected direct RPC access, incorrect hostname/action/cData, expired token, replay, bounded clearance, hard quotas, cancellation and changed identity. The unchanged source response and lack of quote-refresh calls are asserted. The separate B2B suite and 600-request zero-extra-Yahoo instrumentation remain in evidence.

## Free origin blocker

Google Cloud SDK login was renewed with the owner's specific approval. Project utility-trees-399601 is ACTIVE, but billingEnabled=false and billingAccountName is empty. Google App Engine denies version reads with a billing-association error. Existing staging/source buckets are empty; the remaining artifact bucket is not a verified deployment source. A local folder found outside this repository is a Hello World sample and must never replace the production backend.

No Free endpoint was polled, no Yahoo request was made, and no billing account was attached. Restore the project's existing billing association or provide the active replacement backend/source before modifying the Free origin. Preserve its updater, Mac fallback, caching and response contract. A website-only Cloudflare challenge is insufficient because callers can directly reach the App Engine URL.

## Rollback

Disable only the website verification control with `update website_security.control set enabled=false where id=true;`. This is immediate and leaves all original authentication, subscription checks, price response and hard quotas intact. Revert the seven authorized security changes if a full code rollback is needed. Do not disable existing WAF rules, Pro quotas, authentication or the price updater. Preserve verification evidence; no schema drop is required.
