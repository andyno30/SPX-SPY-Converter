# SpyConverter Game / Arpia

Everything for the game lives in this directory. It builds independently of the existing static website, News app and root Supabase configuration.

Live hosting preview: [spyconverter-game.vercel.app/game](https://spyconverter-game.vercel.app/game).

Keep the existing News deployment behavior exactly as it is. Game's build filter is scoped to `game-app/`; it currently has no dependencies on repository files outside that directory. Do not add links, DNS records, or routing to the existing SpyConverter website. The owner will connect the future `/game` URL manually.

The Next.js host mounts at **/game**, including nested routes, API endpoints and assets. Its public release remains a **hosting preview**, with gameplay, cloud saves and authentication disabled. The separate local workbench now runs the shared engine and playable reconstruction: Episodes 0–2 have browser acceptance, and Episodes 3–5 pass engine playthroughs while browser checks continue.

## Run from this directory

```sh
npm ci
npm run research:check
npm run research:report
npm run typecheck
npm test
npm run build
npm start
npm run deployment:smoke -- http://127.0.0.1:3200
```

`npm run build:engine` produces the independent engine library. `npm run content:search -- "Rainbow Worm"` searches research without publishing it.

For local gameplay, run `npm run playtest` and open `http://127.0.0.1:3201/game`. See [the playtest entry](workbench/README.md) and [opening acceptance results](game-docs/architecture/arpia-playtest.md).

`npm run public-release-audit` audits the hosting preview's source boundary, asset allowlist, secrets, flags, /game build prefix and deployment traces. `npm run gameplay-release-audit` **still fails** until playable content, approved assets, authoritative rewards and live Auth/two-user save checks exist. Passing the hosting audit does not mean the game is complete.

## Isolation

- `content/`, `game-docs/`, `research/`, `scripts/`, `tests/` and `supabase/` are package-local.
- `game-docs/` contains game documentation. The repository-root `docs/` contains existing website files and is a separate, untouched directory.
- Only `public/assets/packs/public/` contains publishable assets, with a strict manifest allowlist.
- Historical/reference assets belong in ignored `research/private-assets/reference/`. Nothing reference-only lives under `public/`.
- The preview imports no Phaser, game data, cloud save adapter or research catalog. Existing SpyConverter HTML imports no game code.
- `.env.local`, Supabase CLI state, build output and private assets are ignored here; no root ignore/package changes are needed.

## Dedicated Supabase

The owner created **spyconverter-game** in **Spyconverter Game** (Free), project `hpoibetvznysfsjrnxeh`. The public project URL/key are configured in ignored `.env.local` and the dedicated Game Vercel project. Production Game project variables use `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`; the latter accepts the new publishable-key format. Never copy News credentials or use service-role keys in browser variables.

Migrations are under `supabase/migrations/`. Run future CLI commands from this directory and explicitly verify the new project ID. Migration 001 prepares RLS-protected prototype snapshots; migration 002 disables those writes in hosted projects until server-validated reward commands exist. Both run in the database tests. Hosted migrations and live Auth/save verification are still pending; this preview does not access the database.

See [deployment preparation](game-docs/architecture/arpia-deployment.md), [repository audit](game-docs/architecture/arpia-repository-audit.md), [architecture](game-docs/architecture/arpia-foundation.md), [research report](research/research-report.md) and [implementation sequence](game-docs/architecture/arpia-implementation-sequence.md).
