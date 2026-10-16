# Additional hosting cost estimate

Verified provider pricing on 2026-10-16. The actual existing Supabase project and Cloudflare Workers/Pages account are on Free plans. No paid hosting upgrade was purchased.

| Scenario | Estimated additional monthly base cost |
| --- | ---: |
| Current low-volume verification within free allowances | $0 |
| Cloudflare Workers paid; existing Supabase capacity sufficient | From $5 |
| Supabase Pro plus Cloudflare Workers paid | From $30 |

[Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) lists 100,000 requests/day on Free; paid service starts at $5/month with 10 million requests and 30 million CPU milliseconds included. Excess rates are $0.30/million requests and $0.02/million CPU milliseconds. The API gateway uses Pages Functions/Workers capacity, not static-page-only capacity. The project's fail-closed setting protects access if its platform allowance is exhausted, but a platform-generated error is outside the application's normal JSON 429 contract. Commercial capacity should avoid that ceiling.

[Supabase pricing](https://supabase.com/pricing) lists Pro from $25/month, including 8 GB database disk and 250 GB egress. Edge-function invocation allowance, existing Pro/News traffic, compute and retained event rows must be included in a capacity review. The B2B backend uses the existing project, with a separate restricted pooler role; it does not create another paid project.

At one million conversion requests/month, expect roughly four to five database RPCs and one Edge invocation per request, plus control requests. A one-minute cache-copy cadence adds about 43,200 SELECTs and publications per 30-day month, independent of customer traffic. These are DB operations, never Yahoo requests. Per-request audit storage can dominate the tiny shared snapshot; benchmark retention and indexes before promising capacity.

These are estimates, not a bill or guaranteed spare capacity. Stripe transaction/Billing fees, electronic-signature service, legal work, data rights and taxes are additional. No subscription plan includes unlimited requests or automatic overage billing.
