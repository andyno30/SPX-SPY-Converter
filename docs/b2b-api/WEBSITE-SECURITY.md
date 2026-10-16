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

The four Free pages retain their manual/dynamic ratios, existing source references, formatting, ads, navigation and layout. All sixteen calculation handlers now send the amount, currently displayed ratio and multiply/divide operation to /v1/website/free-calculations. The server performs the same arithmetic after atomic admission; it never reads live Pro prices or invokes any quote provider. Empty-input messaging remains local. Failure of verification or the server cannot fall back to an unmetered local result.

Cloudflare overwrites client identity using its trusted CF-Connecting-IP, hashes it with a server-only HMAC key and forwards only the hash to the private Supabase origin. IPv6 privacy addresses share a /64 counter. Client-supplied identities are ignored. Clearing localStorage, cookies or changing tabs cannot reset the allowance. Anonymous users on the same network share the limit; rotating unrelated networks or independently reproducing public arithmetic cannot be prevented without stronger identity requirements. This protects the hosted calculator, not offline copies of public formulas.

The separate private counter admits exactly ten calculations in a rolling sixty seconds. Request eleven returns JSON 429 and a server nonce. A visible Managed Turnstile widget is loaded on demand. Server-side Siteverify validates hostname, free-calculations action, nonce, age and success. The browser cannot grant clearance. Success grants five minutes of clearance with an absolute twenty/minute ceiling. Failed verification blocks five minutes; cancellation grants nothing. Nonces are single-use, raw tokens and IP addresses are not stored, and inactive hashed counters are pruned after one day in bounded batches.

The new Free path does not accept B2B keys as a bypass, call B2B counters, change Pro limits, or require a new WAF rule. All five existing WAF rules remain unchanged. The gateway is updated within the existing Free Pages project. The original updater schedule, Mac fallback, private pro_price_cache permissions and decoy Google references remain untouched.

Local verification: five backend tests / ten steps and fifteen frontend tests passed. One hundred concurrent synthetic requests admit exactly ten; successful verified clearance admits only ten more; failures block; private RPC, replay, cross-network challenges and direct origin attempts are denied. All sixteen handlers retain original outputs. No market-data fetch exists in this code. Hosted evidence is recorded in free-production-verification.json. A real production human challenge was displayed for review; completing a real CAPTCHA remains a human QA step, not an automated claim.

## Rollback

Disable Pro verification only with the website verification control with `update website_security.control set enabled=false where id=true;`. This is immediate and leaves all original authentication, subscription checks, price response and hard quotas intact. Disable only Free admission with `update website_security.control set free_enabled=false where id=true;`. Revert the eleven authorized security changes if a full code rollback is needed. Do not disable existing WAF rules, Pro quotas, authentication or the price updater. Preserve verification evidence; no schema drop is required.
