# Public replacement assets

Research pass: 2026-09-07. Coverage is partial; unknowns are intentional.

Public and reference manifests share logical IDs across characters, NPCs, pets, monsters, maps, tilesets, portraits, UI, effects, music, SFX, items, equipment and furniture. Engine imports only the resolver interface.

The public manifest is currently empty. That means zero approved assets, not full coverage. Catalog asset IDs are a work queue. Each future entry requires creator, rights/license, source note, relative path and type. Public dialogue is authored separately from reference dialogue.

No original bytes have been imported. Private material stays ignored and outside release output. An inactive reference pack must also be excluded from deployment: simply setting the public pack is insufficient when a bundler automatically copies every public file. The hosting build audits the entire public directory against a strict manifest allowlist before Next.js copies it, and audits the produced output again. Reference material lives at `research/private-assets/reference/`, outside `public/`.

Phase order: temporary explicitly RESTORATION geometry for engine tests; owner-supplied full-frame reference analysis; replaceable public character/map/UI pack; separately commissioned audio; build artifact audit; live configuration and database tests; deployment only when requested.
