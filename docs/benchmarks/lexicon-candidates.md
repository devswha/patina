# Lexicon candidates — queued for the next re-mining

Entries here are NOT part of any lexicon. Every lexicon entry must pass the
pre-registered corpus gate (hot/cold lift ≥4×, phrase ≥6×, cold DF ≤5%, ≥2
registers — see `docs/benchmarks/lexicon-freshness-ko-2026-07.md`), so
candidates wait here until the next re-mining run judges them on evidence.
Adding a candidate to this file carries no claim that it is a real AI tell.

| candidate | lang | source / rationale | queued |
|---|---|---|---|
| "Let that sink in." | en | stop-slop emphasis-crutch list; plausibly high-lift discourse marker | 2026-07-12 |
| "Full stop." (sentence-final emphasis) | en | stop-slop; discourse-function marker | 2026-07-12 |
| sweeping absolutes as false authority (every/always/never in argumentative register) | en | stop-slop "lazy extremes" — likely HIGH cold DF; expect gate rejection, test anyway | 2026-07-12 |
| "The uncomfortable truth is" | en | stop-slop throat-clearing list; overlaps en #22 filler — test whether lexicon-level anchor adds deterministic recall | 2026-07-12 |

Rejected without testing (would corrupt the gate): blanket adverb bans,
em-dash prohibition, Wh-starter bans — style opinions, not corpus-evidenced
discourse markers.
