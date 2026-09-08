# Verification — 2026-09-07 to 2026-09-08

## Completed

- All changes made by this task are under game-app/. No original website, News, Options or root Supabase file was changed. The earlier root .gitignore edit and incidental News tsconfig.tsbuildinfo cache write were restored.
- 218 moved files were hash-verified before path/configuration edits. Catalog validation retains 103 main missions, 37 Free Missions, 274 entities and 83 sources.
- TypeScript checking, the independent engine build, research report generation and all **19 tests** pass. Tests include atomic quests/saves, currency rollback, navigation, gauges, source provenance, asset/environment boundaries and real Git-history build-skipping scenarios.
- Next.js production builds pass the source/output public-hosting audits. Reference-pack selection is rejected before compilation. The separate gameplay release audit remains blocked.
- Local and live HTTP checks pass: /game, /game/status, /game/api/health, the public manifest and every referenced JS/CSS resource return 200. /, /status, /api/health, unprefixed /assets, private/reference URLs, research JSON and /game/dev return 404.
- Browser navigation verifies /game → /game/status. Both pages clearly identify development status; no gameplay, login, or cloud-save controls are exposed.
- Read-only production checks confirmed spyconverter.com/ (GitHub Pages) and news.spyconverter.com/news (Vercel) return 200. This task never altered their routing or production configuration.

## Live Game deployment

- Vercel project: **spyconverter-game** (`prj_DdSykPQqzmA4O0sazFSA0Xru0ZQ3`).
- Repository: **andyno30/SPX-SPY-Converter**; root **game-app**; framework **Next.js**; sibling-file inclusion **disabled**.
- Game's **Skip deployments when there are no changes to the root directory or its dependencies** is enabled and was verified after reloading settings. The checked-in ignored-build script also handles trustworthy Git ranges and builds conservatively when history is unavailable.
- Production hosting-preview URL: [spyconverter-game.vercel.app/game](https://spyconverter-game.vercel.app/game). The approved Game-only rename is saved and Valid Configuration; the full HTTP smoke check passes on the new hostname.
- Current verified production deployment: [5Nwak1CHrhpBfZbQ7Cbbn1fVmafp](https://vercel.com/andyno/spyconverter-game/5Nwak1CHrhpBfZbQ7Cbbn1fVmafp), Ready; source commit **f883533** on **codex/game-production-foundation**. The September 8 follow-up removes the preview's main-site link and records the owner's isolation policy. Its production build, public-hosting audits, and Git-history build-filter test pass. Live HTTP checks and browser inspection confirm neither Game page links to the existing website; the old Vercel address returns a 307 to the new Game hostname with /game preserved.
- The first remote check exposed a Vercel-specific static-file precedence difference. The final vercel.json uses an early status route to deny unprefixed /assets before filesystem resolution. The ordinary rewrite attempt was replaced; the full remote smoke check now passes.
- Preview authentication was retained. The old generated domain project-6mpze.vercel.app redirects to the new Game hostname. No custom spyconverter.com DNS/domain route was added.

## Supabase

Owner-created **spyconverter-game**, project **hpoibetvznysfsjrnxeh**, is Healthy in the dedicated **Spyconverter Game** Free organization. Public connection values are in ignored game-app/.env.local and the Game Vercel project's Production, Preview and Development environments. A read-only request to this project's public Auth settings endpoint succeeded.

No live schema migration, login flow or cloud save was applied/enabled. Both checked-in migrations pass PostgreSQL tests in PGlite with mocked auth roles: owner isolation, denied cross-user reads/writes, atomic revisions, anonymous denial, and hosted prototype-write revocation. This does not substitute for live Supabase Auth testing. The preview does not access the database; public gameplay still requires licensed content and authoritative reward commands.

## Owner-managed website connection

The owner explicitly reserved final **spyconverter.com/game** routing for their own manual work. Do not add links, DNS, or routing to the existing website. No merge to main or change to existing-site routing was made by this task. Other work may independently update main; this game branch preserves its original base.

The latest instruction is to keep **News deployment behavior exactly as it is**. Its settings remain unchanged. The Game-only root, disabled sibling-file inclusion, enabled automatic skipping, and active `node scripts/vercel-ignore-build.mjs` override were re-verified in Vercel. The script skips unrelated changes with a trustworthy comparison; first builds or unavailable history build conservatively, and canceled entries can still appear in Vercel. There are no explicit Game dependencies outside game-app.

The earlier Game hostname approval block is resolved by the owner's explicit approval. The rename was completed through Vercel, and the old generated hostname was retained as a redirect to avoid breaking earlier preview links.
