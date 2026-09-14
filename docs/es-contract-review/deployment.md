# ES contract deployment — September 14, 2026

The user approved deployment after reviewing the implementation.

- GitHub commit: `198528e256ebcc26dc502287581bcc6b28b07342`.
- GitHub Pages [build and deployment](https://github.com/andyno30/SPX-SPY-Converter/actions/runs/34851525162): completed successfully at 13:49:11 UTC.
- Live page: [Spyconverter Pro converter](https://spyconverter.com/docs/premium-feature.html).
- Supabase `get-live-price-pro`: version **30**, ACTIVE, deployed at 13:49:31 UTC.
- `protect_profile_billing_fields` trigger: confirmed present and enabled on production `public.profiles` before publishing the frontend and backend.

## Live verification

- The Pro page serves the ES selector and new module script.
- The shared request helper matches local code byte for byte.
- Dow/Russell serves the new authenticated module; the overlap chart imports the authenticated helper.
- Unauthenticated Auto GET: **401**.
- Unauthenticated `esContract=ESZ26` GET: **401**.
- Invalid Bearer token: **401**, session expired response.
- CORS OPTIONS: **204**, no prices.
- All responses tested carry `Cache-Control: private, no-store`.
- Supabase function metadata confirms only `get-live-price-pro` changed; Stripe, news, account and options functions retain their previous versions.
- The 9 backend and 6 frontend/database tests passed again during release. The earlier production build and existing 4 news tests had already passed.

## Remaining account check

The available Spyconverter browser session is signed out. The Pro login tab is open for the user. Actual signed-in Pro contract switching and actual non-Pro rejection against version 30 remain unverified; those paths passed controlled tests before release. No user account, subscription, or credentials were changed to manufacture a test session.

Existing open Pro tabs may need one reload to receive the session-bearing scripts. Auto remains the default, following Yahoo `ES=F`; users can choose December 2026 explicitly.

The deployment commit includes only the reviewed feature, its targeted authorization safeguard, tests and provider probe. Pre-existing local news edits and SQL remain uncommitted and were not deployed. The review/evidence folder is kept local.
