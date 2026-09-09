# Game documentation

This folder contains the Arpia reconstruction's research and engineering documentation. Its name distinguishes it from the repository-root `docs/`, which holds existing SpyConverter website files.

- [Current research and implementation counts](../research/research-report.md)
- [Opening gameplay acceptance](architecture/arpia-playtest.md)
- [Implementation sequence](architecture/arpia-implementation-sequence.md)
- [Deployment and isolation](architecture/arpia-deployment.md)
- [Main mission catalog](research/03-main-missions.md)
- [Free Mission catalog](research/04-free-missions.md)
- [Sources](research/00-source-index.md)

Individual mission dossiers live in `research/missions/main/` and `research/missions/free/` beneath this folder.

On 2026-09-09, all 173 files from `game-app/docs/` were moved here with matching hashes before references were updated. The 27 files in the website's root `docs/` were checked byte-for-byte and left unchanged. The report generator and production exclusions now use `game-docs/`. Both the current and legacy documentation directory names remain blocked from public assets and host imports.

The original repository migration inventory preserves historical `from` paths and hashes; its game-documentation destinations now point here. These historical hashes describe the original migration, not later edited documents.

Latest development checkpoint: [Episode 6 and save recovery](architecture/arpia-continuation-2026-09-09.md).
