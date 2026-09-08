# Arpia repository audit — 2026-09-07

This is an additive reconstruction project targeting `spyconverter.com/game` in a future release. No deployment or existing Supabase changes are part of this audit.

## Repository baseline

149 tracked files; clean working tree before this session. No applicable AGENTS.md, existing game engine, game assets, or `.openai/hosting.json` was found. The supplied attachment contains the project brief only; screenshots A/B/C are absent.

| Area | Current implementation | Reuse decision |
| --- | --- | --- |
| Main website | Static HTML, CSS and JavaScript; root CNAME points to SpyConverter | Preserve. Future `/game/` can be a separately built directory or reverse-proxied app. |
| News | Isolated `news-app/`, Next.js 14.2.25 App Router, React/React DOM 18.3.1 | Reuse architectural patterns; avoid coupling game styling, authentication or build to news. |
| Tooling | npm lockfile; TypeScript ^5.8.2, Tailwind ^3.4.17, PostCSS, ESLint | Give `game-app/` its own lockfile and commands. |
| Supabase | supabase-js ^2.49.8 in news; browser/server client factories; static account client in `docs/auth.js` | Existing project is for SpyConverter. Never import its client, credentials or project link into Arpia. |
| Backend | Existing Supabase Edge Functions for subscription, portal, account deletion, news and market data; separate legacy login backend | No game functions to reuse. Keep these intact. |
| Database | Root `supabase/sql` setup scripts and root linked CLI state | Arpia migrations live under `game-app/supabase/`; never run the game migration from the root Supabase directory. |
| Automation | Two manual GitHub Actions update options/news JSON | Preserve. No Arpia deploy workflow enabled. |
| Existing game | None; no Phaser dependency, `/game` route or archival pack | Start a separate engine foundation after cataloging evidence. |

## Route inventory

Static root routes: `/`, `/converter.html`, `/EStoSPX.html`, `/RUSSELL2000andDOW.html`, `/relationship.html`, `/aboutus.html`, `/blog.html`, `/pro.html`, `/trading-journal.html`, `/options/`, and `/Articles/article1.html` through `/Articles/article20.html`.

Static account/pro routes under `/docs/`: login, register, confirmation, forgot-password, reset-password, dashboard, settings, spyconverterpro, premium-feature, dow-russell-feature, spx-spy-overlap-chart (all `.html`). Root `sitemap.xml`, `ads.txt`, assets and data feeds also exist.

Next.js routes: `/` redirects to `/news`; `/news`; `/api/cron/fetch-news`; `/sitemap.xml`; favicon. No catch-all routes or game rewrites exist.

## Baseline checks

`npm run typecheck` in `news-app` passed. Next.js development server started on loopback port 3100. See the session verification report for the HTTP result. No packages were upgraded in the existing app. The runtime HTML includes a Google font dependency and news loading requires network access; neither is appropriate as an engine dependency.

## Integration boundary

`game-app/` owns engine, adapters, tests, credentials and isolated Supabase migrations. `game-app/content/` owns version-controlled research and future authored definitions. `game-app/docs/research/` is the research bible. All game material is now physically under `game-app/`. No existing auth client is imported. The intended URL prefix is `/game/`, including assets and authentication callbacks; a dedicated Vercel project is the selected host. See [deployment preparation](arpia-deployment.md) for current verification and final domain-routing constraints.
