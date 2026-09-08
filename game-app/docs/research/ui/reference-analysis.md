# Reference analysis — 2026-09-07

## Supplied-reference gap

Screenshots A/B/C are described in the brief but absent from the attachment directory. No original screenshot dimensions or UI measurements can be attributed to them. Obtain the three full frames before the historical UI implementation pass.

## Archive images actually inspected

- Wonavy Episode 0 (https://wonavy.tistory.com/187): school overview artwork 420×324, Skoll portrait 440×507 and another school image 420×402 reported by loaded DOM images. Viewed the school artwork and George/Skoll imagery in browser. These are illustrations/crops, not proof of the original game canvas size.
- Have Alice promotion post (https://alicer.tistory.com/59), published 2009-07-17: first dialogue crop 690×512; later battle-victory crop 688×572. Browser visual inspection confirmed these are game captures, but text and HUD edges are cropped. Natural image dimensions are not the game's logical resolution.

## Observations and implementation consequences

| Property | Observed evidence | Confidence / unresolved |
| --- | --- | --- |
| Aspect ratio/resolution | Different crop sizes and aspect ratios | Original logical size UNKNOWN; do not infer 800×600 or 1024×768 from crops. |
| Dialogue | Large illustrated speaker on left and protagonist on right; scene background remains; patterned cream strip below a thin blue border | HIGH for these crops; full panel height/width and outer margins unknown. |
| Portrait scale | Portraits occupy most of scene height in visible dialogue crop | MEDIUM; crop prevents absolute scaling. |
| Typography | Compact bold dark Hangul on cream; outlined text over battlefield | HIGH visually; original font and English fallback unknown. |
| Battle | Player/pets right; log upper-left; five bottom party cells, last two empty | HIGH for frame layout; controllability not established by a still. |
| Battle HUD | Saturated blue frames and compact colored HP/MP lines | HIGH for styling; screenshot cuts the bottom and left edges. |
| Window styling | Victory message has thick rounded/beveled blue frame, yellow header, pale blue body and green confirmation button | HIGH for screenshot state only. |
| Exploration HUD/minimap | User brief describes mission upper-left, minimap upper-right, bottom controls | User requirement; exact historical geometry pending supplied screenshots. |
| Sprite scale | Victory crop has small chibi units relative to battlefield | MEDIUM; approximate visual scale only, no collision size inferred. |
| Map labels | No complete exploration screenshot analyzed | UNKNOWN. |
| Button behavior | Cropped Next control visible in dialogue; confirmation visible in victory | Hover/pressed states, keyboard/touch and timing UNKNOWN. |
| State changes | Dialogue and battle victory frames found | Animation/gauge progression cannot be reconstructed from stills. |

Use normalized layout anchors and a configurable logical resolution. Keep world/sprites in Phaser; keep UI overlay positions tied to the same logical canvas. Fit uniformly with letterboxing on smaller devices. A restoration test canvas is not an authentic UI replica. No source screenshots were downloaded into the public asset tree.
