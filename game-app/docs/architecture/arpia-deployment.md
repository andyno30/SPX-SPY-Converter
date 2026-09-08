# Game deployment preparation

## Repository boundary

One repository: `andyno30/SPX-SPY-Converter`. All game code, content, documentation, scripts, tests, credentials and migrations live in `game-app/`. No dependency resolves through News or another repository-root folder. The original root `.gitignore` and News `tsconfig.tsbuildinfo` were restored byte-for-byte; the latter was an incidental TypeScript cache write, not a News source change.

218 moved files were hash-verified before path/configuration edits. [Migration inventory](migration-inventory.json) records their original and initial destination paths/hashes. The public-pack README was subsequently moved into game documentation so no documentation is served from public/. Research/content records were preserved.

## Vercel

| Project | Repository | Root directory | Status |
| --- | --- | --- | --- |
| spyconverter-news | andyno30/SPX-SPY-Converter | news-app | Existing, unchanged |
| spyconverter-game | andyno30/SPX-SPY-Converter | game-app | Live hosting preview; see verification report |

Game project ID: `prj_DdSykPQqzmA4O0sazFSA0Xru0ZQ3`. Public origin: `https://spyconverter-game.vercel.app`; use `/game`. The owner explicitly approved this Game-only hostname rename. The existing GitHub integration is connected; the main branch remains the eventual production source. The initial hosting preview is deployed explicitly from the isolated game branch.

Game preset: Next.js. Node: 22.x. Install: `npm ci`. Build: `npm run build`. Output: framework default. Include files outside root: disabled. No root workspace/package file is required. Pinning Next.js/React here does not upgrade News.

Game-only automatic skipping is enabled in Vercel and verified after reload. The checked-in Vercel ignored-build script compares the previous deployment SHA with the current SHA scoped to game-app. Missing/shallow history builds conservatively. An existing-root change does not become a Game dependency. The first build always runs. The preview branch is `codex/game-production-foundation`; main and production domain routing are unchanged.

The owner reaffirmed: **Keep the existing News deployment behavior exactly as it is. Configure the Game Vercel project so changes outside game-app/ do not trigger a Game deployment unless they are files that game-app explicitly depends on.** No such outside dependencies currently exist. Preserve this boundary when adding dependencies; do not turn unrelated root files into implicit inputs.

The path-scoped ignored-build command is the effective fallback for this repository: Vercel's automatic workspace optimization requires a workspace layout, which this isolated-app repository does not use. Vercel may still create a canceled deployment entry before the ignored-build command runs. First builds or unavailable comparison history build conservatively; this configuration is not a guarantee of zero dashboard entries. Branches without game-app cannot run its script. No root workspace file or unrelated test commit was added to change existing website behavior.

News retains its existing settings, including disabled automatic skipping and inclusion of files outside its root. The latest explicit instruction to preserve News governs this pass; no News configuration was saved.

## Routes

Next.js `basePath` is `/game`, built into routing and framework resources. `next/link` receives app-relative paths (e.g. `/status`) and applies the prefix. The engine asset resolver uses `/game/assets/packs/`; raw fetch URLs use `gameUrl`. Do not use `assetPrefix` as a substitute for route mounting. Vercel also exposes copied public files at unprefixed paths; the game-only vercel.json status route rejects /assets/* before static-file resolution. This rule belongs only to the Game origin, not the existing SpyConverter domain.

- `/game`: honest development notice; no playable content.
- `/game/status`: public development status.
- `/game/api/health`: non-sensitive deployment health, with gameplay/cloud saves explicitly disabled.
- `/game/assets/packs/public/manifest.json`: public allowlist.
- All framework assets: `/game/_next/*`.
- `/game/dev`, `/game/research/*`, `/game/content/research/*` and reference-pack URLs: 404.

Visiting the project URL at `/` intentionally returns 404: verify using `/game`. Existing SpyConverter pages import no Game JavaScript. The hosting preview itself imports no Phaser, gameplay library, mission data or Supabase snapshot adapter. A future playable route must introduce explicit dynamic loading and pass new gameplay gates before that audit boundary changes.

## Final domain routing belongs to the owner

The owner will manually connect the future spyconverter.com/game URL. Do not add links to/from the existing website, attach its domain to Vercel, or change its DNS, routing, hosting, or News settings. The Game preview has no link to the main website. The notes below are reference information for the owner's later work, not an instruction to apply changes.

Read-only HTTP checks identify the main site as **GitHub Pages** and News as **Vercel** at `news.spyconverter.com`. GitHub Pages cannot acquire a Vercel rewrite from game-app/vercel.json. A DNS record also cannot route a URL path by itself.

First verify the dedicated Game deployment at its Vercel URL under `/game`. Then separately review an edge/reverse-proxy change on the existing domain that forwards **only** `/game` and `/game/*` to the verified Game origin, preserving the complete path. This includes `/game/_next/*`, `/game/assets/*`, and `/game/api/*`. All other paths must retain the existing GitHub Pages origin. No catch-all rewrite to Game, no apex-domain reassignment, and no changes to News are prepared for automatic application.

Rollback must remove only those two Game routing rules, returning the main-site origin behavior. DNS/edge configuration, TLS, cookies, status redirects, caching, and authenticated callbacks need end-to-end verification on the actual domain before declaring `/game` live. These changes are intentionally not attempted while the no-existing-site-change constraint stands.

## Dedicated Supabase

Owner-created project: `spyconverter-game`, project ID `hpoibetvznysfsjrnxeh`, organization `Spyconverter Game`, Free plan, West US (Oregon). This differs from the existing SpyConverter project, which the game adapter rejects.

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are configured in ignored game-app/.env.local and in the Game Vercel project (Production, Preview and Development). ANON_KEY uses the new publishable-key value; a service-role/secret key is never accepted. The preview does not initialize Auth or access tables. No live migrations have been applied by this deployment-preparation pass.

The two reproducible migrations are tested together in PostgreSQL (PGlite, mocked auth roles). Migration 001 provides versioned ownership-protected prototype storage; migration 002 revokes prototype snapshot writes from all API roles. Future CLI linking/application must run from game-app and target the exact new project, then verify migration history and live Auth/two-user isolation. Do not enable the private prototype as public gameplay.

## Release checks

`npm run build` validates catalogs, checks source imports/environment/public assets, builds Next.js, and audits its static/server artifacts and file traces. It rejects reference selection, even empty reference directories under public/, unlisted files, symlinks, debug/cheat flags, exposed service keys, localhost URLs, private imports and traces escaping game-app. The manifest includes no approved art/audio yet.

The preview audit can pass because it publishes only a development notice and health endpoint. `npm run gameplay-release-audit` retains a separate blocking result for missing playable content, licensed assets, authoritative rewards, and live Auth/save verification. A hosting pass must never be described as finished or verified gameplay.

Sources: [Next.js basePath](https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath), [Vercel monorepos](https://vercel.com/docs/monorepos), [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json).

## Game Vercel hostname

The approved hostname spyconverter-game.vercel.app is attached only to the Game project's Production environment and has Valid Configuration. The old generated address project-6mpze.vercel.app redirects to the new Game hostname with status 307, preserving existing preview links. Neither address changes or routes through the existing SpyConverter domain.
