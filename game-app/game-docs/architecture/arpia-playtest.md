# Playable opening acceptance — 2026-09-08

## Isolation

All implementation, research, artwork, tests and local playtest scaffolding live under `game-app`. The production Next.js route tree remains the hosting preview. The local `workbench` entry is separate and gated to development. No existing SpyConverter/News/Options routes, deployment settings, domains or backend files were changed. The production Game ignore-build rule remains `node scripts/vercel-ignore-build.mjs` scoped to Game dependencies.

## Implemented

Episodes 0, 1 and 2 are executable restoration content: five quest definitions including three homeland branches, 24 maps, 71 dialogue sequences, 20 actors, 12 spells, seven items, four pets, two story battles, and school shops/lessons/recovery/pet services. Later entries remain research catalog records.

The shared pure engine owns movement validation, story flags, ordered objectives, transactional rewards, companion membership, ATB combat, elemental relationships, status expiry, inventory and services. Phaser renders the world and battle; React presents dialogue, menus, mission directions and the minimap. The browser store uses Web Locks and optimistic revisions. Imported/corrupt local saves must pass schema and campaign-reference validation before loading. No client snapshot is accepted by a public cloud endpoint.

## Browser acceptance

The Flame student Liora completed the school tour, all Episode 1 visits and the Kesno duel, and Episode 2's bread/jar/shortcut, eagle rescue, Shiva return, medicine retrieval, Aaron escort and Odangka battle through visible UI controls. Episode 1 Fire spent five MP; player and pet turns both worked. The second encounter displayed five distinct allied HP/MP/gauge panels and accepted turns from all roles. Final completion showed level 3, 145 Pin and 36 Virtue; those numbers are restoration balance. The medicine and bread were consumed; the wand and two pets remained. Temporary companions left after reporting to Morris. Equipping the wand worked through Inventory. A full reload preserved earlier mission progress.

Test viewport: approximately 637 × 774, with the 960 × 640 game frame uniformly scaled. Checked character selection, portraits, dialogue, quest HUD, minimap, battle panels, inventory, equipment and settings. Corrected module resolution, asset-root lookup, scene subscription cleanup and battle-panel overlap found during browser inspection.

## Automated checks

29 tests pass, including all three homeland playthroughs with serialized reloads at objectives, deterministic battle ticks, invalid action rejection, atomic currency/item transactions, lesson proficiency, pet evolution, corrupted-save rejection, save failures and revision conflicts. Existing SQL prototype/RLS, public asset allowlist, path isolation and Vercel ignore-rule tests still pass. Production hosting-preview build and public-release audit pass. Engine and workbench TypeScript checks pass.

## Remaining work

Continue school progression, authentic maze reconstruction and later story arcs. The current map geometry, English dialogue, combat numbers, UI measurements and SVG study art are authored replacements, not recovered original data. Rich map architecture, final animation/art/audio, rank examinations, broader world content, Free Missions, dorm/mail/social/fishing systems and secure account/cloud gameplay are unfinished. Browser testing currently covers Flame; Ice and Earth complete the engine suite but still need separate full browser acceptance. This checkpoint is not completion of the full game and is not a public gameplay release.

Run `npm run playtest` from `game-app`, then visit `http://127.0.0.1:3201/game`.
