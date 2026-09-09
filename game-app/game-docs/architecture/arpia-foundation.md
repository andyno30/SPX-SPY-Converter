# Research and engine boundaries

## Evidence precedes runtime

`content/research/` contains catalog records, not executable quests. An object-level provenance describes its catalog identity only. Each additional historical assertion has its own claim, sources, confidence and unknowns. Null means unknown, never zero. English names are working localizations, not official translations.

Source families are tracked explicitly: readonly.wiki and tcatmon are related wiki mirrors, not two independent witnesses. Wonavy is a later retrospective. Have Alice posts dated during service are contemporary player evidence, but numerical anecdotes are not drop-rate measurements. A publisher press release is primary evidence for its announcement, not for every game mechanic.

Mission discovery, research, scripting, playability and historical verification are separate milestones. A title match and a page with images do not verify quest scripts. Image references are counted separately from visually inspected screenshots. Main catalog contains exactly Episode 0–102; Free Missions use stable IDs without pretending their list order was historical episode numbering.

## Layers

1. **Research**: sources, scoped claims, title variants, missing information and per-mission dossiers.
2. **Authored content**: strict executable definitions with logical references. Only intentionally authored scripts enter the engine; no conversion of all catalog entries into fake playable quests.
3. **Pure engine**: deterministic quest conditions/events, transactions, map pathfinding, maze graphs, action gauges and versioned saves. No Phaser, React, DOM or Supabase imports here.
4. **Adapters**: Phaser scene presentation, input, local storage and Supabase snapshots. The host creates adapters; the engine depends on interfaces.
5. **Deployment host**: a Next.js hosting preview mounted at `/game`. Public gameplay and cloud saves are disabled. The future canvas will be loaded only from the game route, after content and gameplay release gates pass. Scene lifecycle owns cleanup; React never owns quest logic.

Runtime model reserves a protagonist, two pet slots and two temporary companion slots. Rank, spells, pets, inventory, faction flags, conditional portals, room discovery and typed phrases are versioned data. Historical formulas are unavailable; any synthetic test mechanics are RESTORATION fixtures, never historical balance defaults.

## Assets and dialogue

Gameplay stores `npc.skoll.portrait` and `episode_000.george.001`, never an archive filename or dialogue string. Public and reference packs resolve the same semantic IDs. Missing assets fail explicitly; there is no fallback from public to reference. Public pack entries require rights metadata. Original bytes belong in ignored `research/private-assets/`; local reference mounting is an explicit developer operation.

Reference assets live at `research/private-assets/reference/`, physically outside `public/`. The public directory contains only the approved manifest and files named in it. Source and output audits reject reference directories (even empty), unapproved files, symlinks, private imports, secrets, localhost URLs and enabled debug flags. Next.js copies public files only after this allowlist passes.

## Persistence

The initial save envelope is versioned and stores meaningful state. Position is included when a transaction saves; movement ticks do not trigger writes. Local storage and cloud use the same validated envelope. Revisions prevent silent overwrite across tabs/devices. A failed save must leave the last good save intact and be surfaced to the host.

Arpia uses new environment variables and a different Auth storage key. No fallback to the existing SpyConverter backend. SQL migrations are reproducible and scoped to the new project. The initial cloud snapshot is explicitly a private, client-authoritative prototype: RLS protects ownership but does not prove rewards were earned. Before a public competitive/social economy, replace client reward submission with authenticated, idempotent server commands and append-only currency/virtue ledgers. Migration 002 revokes prototype write access from API roles. The hosting preview excludes cloud prototype code; the separate gameplay release audit remains blocked.

## Deferred interfaces

Authored content will extend to inventory/equipment slots, class requirements and proficiency, pet affinity/training/evolution, promotion exams, encounters, shops, dormant social services, dorm furniture and Colosseum. Do not create speculative rules as historical defaults. A social schema is a future interface design, not working multiplayer. Fishing remains research-only pending mechanics and location evidence.

Technical references: [Phaser scenes](https://docs.phaser.io/phaser/concepts/scenes), [Zod validation](https://zod.dev/basics), [Supabase grants and RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). Accessed 2026-09-07.
