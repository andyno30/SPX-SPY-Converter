# Economy

Research pass: 2026-09-07. Coverage is partial; unknowns are intentional.

Use Pin for normal money and Virtue Points for 선행점수. The retrospective overview reports mission-earned Virtue Points and a later reward increase, so balances must be tied to an evidence period. **RECONSTRUCTED / MEDIUM**. [Currency account](https://www.readonly.wiki/w/마법학교%20아르피아).

Class fees, teleport costs, healing, pet care, furniture and repeatable mission rewards remain unset. The engine must commit purchases/rewards atomically and reject negative or non-finite balances. Restore balance options must not overwrite historical values.

Private local/cloud prototype snapshots are client-authoritative. RLS prevents cross-player access but does not validate earned rewards. Server-side commands and currency/virtue ledgers are a public-economy release requirement.
