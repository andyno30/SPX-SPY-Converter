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
- Production hosting-preview URL: [project-6mpze.vercel.app/game](https://project-6mpze.vercel.app/game).
- Verified deployment: [A4sPN12qtw3ap9VKEgwY3PkPfiPM](https://vercel.com/andyno/spyconverter-game/A4sPN12qtw3ap9VKEgwY3PkPfiPM), Ready; source commit **03cc0ea** on **codex/game-production-foundation**. Later documentation-only commits do not change this verified runtime.
- The first remote check exposed a Vercel-specific static-file precedence difference. The final vercel.json uses an early status route to deny unprefixed /assets before filesystem resolution. The ordinary rewrite attempt was replaced; the full remote smoke check now passes.
- Preview authentication was retained. The public hosting preview uses the Game project's original generated domain; no custom spyconverter.com DNS/domain route was added.

## Supabase

Owner-created **spyconverter-game**, project **hpoibetvznysfsjrnxeh**, is Healthy in the dedicated **Spyconverter Game** Free organization. Public connection values are in ignored game-app/.env.local and the Game Vercel project's Production, Preview and Development environments. A read-only request to this project's public Auth settings endpoint succeeded.

No live schema migration, login flow or cloud save was applied/enabled. Both checked-in migrations pass PostgreSQL tests in PGlite with mocked auth roles: owner isolation, denied cross-user reads/writes, atomic revisions, anonymous denial, and hosted prototype-write revocation. This does not substitute for live Supabase Auth testing. The preview does not access the database; public gameplay still requires licensed content and authoritative reward commands.

## Pending owner decisions

Final **spyconverter.com/game** routing is pending a separately reviewed edge/proxy change because the existing main origin is GitHub Pages. No merge to main or change to existing-site routing was made by this task. Other work may independently update main; this game branch preserves its original base.

Automatic approval review rejected saving **News build skipping**, citing the user's instruction not to change the existing website. The unsaved change was discarded and the disabled state verified. News may still create unnecessary preview builds for game-only pushes until the owner explicitly approves this setting change.

Automatic approval review also rejected renaming **project-6mpze.vercel.app → spyconverter-game.vercel.app**, because the exact hostname change was not explicitly authorized. The unsaved rename was discarded; the original domain remains valid. No workaround was attempted for either rejection.
