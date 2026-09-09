# Local Arpia playtest

From `game-app`, run `npm run playtest`, then open `http://127.0.0.1:3201/game`.

This separate Next.js entry uses the shared game engine and UI from `src/`, and the executable campaign from `content/adventure/`. It is outside the production `src/app` route tree. The dedicated Game Vercel project still builds the hosting preview using `npm run build`. Its gameplay and cloud-save gates remain closed.

The workbench page and asset handler return 404 outside development. The handler serves only manifest-listed public artwork. Reference media, research, private files, and arbitrary paths are never served. The server binds to loopback only. Run commands from `game-app`; this entry does not depend on repository-root files.

Episodes 0–2 have browser acceptance. Episodes 3–6 now have executable scripts and complete engine playthroughs for all three homelands; their browser acceptance is pending. Character creation, walking, dialogue, local browser saves, battles, shops, lessons, inventory, equipment and pet training run through the same campaign/session layer. The title screen can review and restore downloaded backups; storage failures or progress changed in another tab prevent replacement. Later missions remain research records. The original game’s precise maps, dialogue and numerical balance have not been recovered; their working replacements are labeled RESTORATION in the content.
