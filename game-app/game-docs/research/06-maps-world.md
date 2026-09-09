# Maps and world

Research pass: 2026-09-07. Coverage is partial; unknowns are intentional.

The map catalog now includes school facilities, all three home villages, kingdom locations, forbidden gates, fishing and Skull Island. **RECONSTRUCTED / MEDIUM** for named locations; this is not a recovered navigable map. [Romi map catalog](https://lostmediawiki.kr/w/마법학교%20아르피아/맵).

`content/research/maps.json` separates named maps from unknown dimensions, walkability and portal coordinates. School grounds and hall are additionally supported by the Episode 0 narrative. [Episode 0](https://wonavy.tistory.com/187).

Do not infer actual adjacencies from the encyclopedia section hierarchy. Before authoring each runtime map: identify its screenshot, calculate logical coordinates, trace walkable polygons, mark NPC/portal anchors, record directionality/unlock conditions, then test reachability. The school tour supports floors 1–4 and a basement but does not recover exact room geometry.
