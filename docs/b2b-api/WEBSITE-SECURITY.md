# Website human verification — separate from the B2B API

The owner authorized backward-compatible Free/Pro human verification and protection against direct-origin bypass. The five existing Cloudflare website WAF rules remain unchanged. No B2B links were added to the original website.

## Pro implementation

The existing authenticated `contact-for-licencing` endpoint validates the existing Supabase identity and Pro subscription, then calls an atomic private `website_security` control. It asks for human verification above 30 admitted requests in a rolling minute. A successful server-verified Cloudflare Turnstile token grants five minutes of bounded clearance, still limited to 60/minute and the existing hard quotas. Three failed verification attempts lead to a five-minute block. Normal 60-second price polling remains unchanged. Authenticated-user identity binds the counter and challenge, so direct Supabase calls cannot evade it by changing IP or bypassing the website.

A dedicated Managed Turnstile widget, `SpyConverter website verification`, permits only spyconverter.com and has no pre-clearance. Public sitekey: 0x4AAAAAAFYuYWUcIqoM4vKc. Its secret is in Supabase's secret manager. The new `website-verification` Edge function validates identity, existing paid entitlement, exact origin, server-issued challenge, token hostname/action/cData, age and single-use result. Clients have no permission to write counters or claim verification directly. The UI loads Turnstile only when challenged and retries once after confirmed verification. Cancellation or identity changes grant nothing.

The verifier and limiter contain no market-data fetching capability. Successful price JSON remains byte-identical to the existing handler. Existing 120-second freshness checks, formulas, updater and hard quotas are untouched. Website code and verification never execute on B2B machine API paths; B2B continues returning JSON limits without CAPTCHA.

## Deployment state

The private schema, verifier and extended price endpoint are deployed. GitHub Pages build cce0d42 succeeded, and all five affected static assets byte-match the reviewed release after a ten-URL cache purge. The control was then enabled at 2026-10-16 19:07 UTC. Hosted tests admitted exactly 30 of 70 concurrent disposable-user control requests and challenged the remaining 40 with one identity-bound nonce; a separate identity remained independent. Invalid users receive 401, non-subscribers 403, and direct public/authenticated cache and forged-verification RPC access are denied. Real human completion of a production Turnstile challenge was not automated; token-completion cases passed with mocks. Evidence is in website-security-hosted.json and security-activation.json.

SQL migration source: supabase/sql/website_human_verification.sql. New private rows contain only bounded timestamps, nonce and verification state for an existing auth user. No IP address, raw Turnstile token, JWT, payment detail or market data is retained. SQL tables are inaccessible to browser roles; only the service role can execute the controlled function. Historical billing and agreement records remain intact.

## Tests

49 Deno regressions / 12 steps passed; 66 Node regressions passed, followed by all 20 SQL tests using the required test dependency path. The initial full Node command had four dependency-loader failures (missing pglite); rerunning those four files with the correct NODE_PATH passed. Do not report the initial command as entirely successful.

Tests exercise concurrent 30/70 admission, independent users, nonce binding, rejected direct RPC access, incorrect hostname/action/cData, expired token, replay, bounded clearance, hard quotas, cancellation and changed identity. The unchanged source response and lack of quote-refresh calls are asserted. The separate B2B suite and 600-request zero-extra-Yahoo instrumentation remain in evidence.

## Free pages and the existing Supabase backend

The legacy App Engine reference is outside the active-backend scope. Investigation stopped; no Google project billing, deployments, resources or source references were changed. The actual production backend is the existing Supabase project.

The Free pages retain their manual/static ratios and existing source references. Do not connect Free users to live Pro data. Their attempted unauthenticated Supabase fallback is denied; public and authenticated direct access to pro_price_cache is denied. The existing spy-ingest source was read only and still requires its private ingestion secret; the Mac fallback and automation were not invoked or modified.

The five existing Cloudflare WAF rules remain active and unchanged. No new 10/minute Free-page challenge was installed. The current Free pages do not have an unrestricted live Supabase price route to which that market-data threshold could safely be added. Cloudflare's standard Free rate-limiting rule supports a ten-second window and does not implement the requested one-minute human-challenge workflow. Replacing the existing static Free experience or exposing Pro data would violate the preservation requirement. See [Cloudflare rate-limit availability](https://developers.cloudflare.com/waf/rate-limiting-rules/) for plan constraints. This limitation is separate from the deployed Pro control and B2B quota enforcement.

## Rollback

Disable only the website verification control with `update website_security.control set enabled=false where id=true;`. This is immediate and leaves all original authentication, subscription checks, price response and hard quotas intact. Revert the seven authorized security changes if a full code rollback is needed. Do not disable existing WAF rules, Pro quotas, authentication or the price updater. Preserve verification evidence; no schema drop is required.
