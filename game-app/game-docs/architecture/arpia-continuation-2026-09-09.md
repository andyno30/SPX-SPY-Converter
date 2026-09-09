# Arpia continuation — 2026-09-09

The game remains isolated inside `game-app/`. Documentation now lives in `game-docs/`; all 173 moved files matched their old hashes before references were updated. The website's root `docs/` has 27 files, all unchanged against the pre-move hash snapshot. There are no working or committed changes outside `game-app/` relative to the original local main baseline.

## Executable content

Episodes 0–6 have scripts: nine quest definitions including Episode 1's three origin branches, 44 maps, and 111 logical public asset IDs. Episodes 0–2 have browser acceptance; Episodes 3–6 pass complete engine playthroughs for Flame, Ice and Earth, with serialized reloads at every objective. They remain SCRIPTED until browser acceptance. Nothing is fully historically VERIFIED.

Episode 6 adds a gated key chest, Eagle Village, the waterfall and Jackal's den. The key persists and the postcard is consumed. Naomi hands her active companion slot to Skoll while Jackal remains with the player. This handoff, English lines, numerical rewards, geometry and original vector studies are marked RESTORATION. The specific original party transition remains unknown.

Episodes 7–8 now have reviewed narrative dossiers, but no active maze: the exact room graph and riddle answers have not been recovered. The two reported clues are not treated as answers. A contemporary later-episode map is indexed as an uninspected visual lead.

## Interaction and persistence work

- Direct scene clicks now pass interaction context to React, enabling the same teacher services and nearby phrase chat as the Nearby list. Pet evolution refreshes its scene appearance immediately.
- Commands are parsed before state reduction. Unknown actions, injected reward/item-power fields, invalid quantities and oversized phrases fail without changing saved progress.
- Campaign validation rejects unknown condition references, duplicate portal IDs, ambiguous map targets, incomplete services, and unsupported repeatable quests.
- The title screen offers backup selection, character/location review and explicit restore. A changed local save after review causes a conflict; invalid files and quota failures preserve existing storage. A reviewed valid backup can recover unreadable local data. This is local recovery, not an acceptable public cloud-save write API.
- Status damage now interrupts escape attempts. A surviving party helps a fallen student stand with 1 HP after victory or escape, so the next encounter is not blocked by an unconscious overworld player. This recovery rule is an authored balance decision.

## Validation

39 automated tests pass, including all three origin playthroughs through Episode 6, wrong door phrases, atomic state/persistence failures, backup recovery, content references, combat regression cases, PGlite owner isolation and Vercel ignore behavior. TypeScript, the engine build, production Next.js build, and source/output public-release audits pass.

The Mac was locked during this checkpoint. New UI changes, original vector studies, and Episodes 3–6 still need browser inspection. No browser acceptance was inferred from engine tests.

## Deployment boundary

The dedicated Game Vercel configuration still watches `game-app/`, with its ignore command skipping unrelated changes when a usable prior commit exists. Missing git history conservatively builds. News settings are unchanged. The live Game site remains a hosting preview; this work has not enabled public gameplay or cloud saves, changed SpyConverter routes/domains, or applied hosted Supabase migrations.

Resume with an independent local browser save for Episodes 3–6, including scene-click services, the typed crescent-door phrase, backup restore and the new companion handoff. Then inspect the surviving maze images before implementing Episodes 7–8. Public gameplay still requires the server-authoritative command/economy path and live authentication/persistence validation.
