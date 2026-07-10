# Rewrite-efficacy pilot — results

Rows: 44 (of 48; 4 excluded as register spok per Deviation 4). Arms: A, B, C. Judges: judge-gemini, judge-kimi.
Decision rules are those pre-registered in `2026-rewrite-efficacy-prereg.md`.

## Data losses (logged, not hidden)

- rewrite failures: 0/44
- rows with >=1 unparseable judge response: 2/44

## RQ5a — meaning-safety gate (MPS / fidelity / dropped numbers)

Pass rate: **100.0%** (44/44). Pre-registered target: >= 95%.
**H5a: met.**

- primary-panel ratings present: 173/176 (of these 61 repaired by the top-up pass, 13 needed a retry, 0 used a drifted score key)
- `judge-gpt` (partial third rater, quota-exhausted): 52 ratings — reported separately, excluded from the primary panel

## RQ1 — construct validity (inter-judge agreement)

| arm | stimulus | units | Krippendorff alpha | Spearman rho | mean abs gap |
|---|---|---:|---:|---:|---:|
| A | document | 26 | 0.821 | 0.868 | 13.0 |
| B | snippet | 27 | 0.668 | 0.776 | 17.0 |
| C | snippet | 32 | 0.862 | 0.758 | 9.2 |

**RQ1 verdict: PASS** — Arm A alpha 0.821 >= 0.4. Efficacy estimates below are interpretable.

### Stimulus-length moderator (Arm A vs Arm B, same items)

Document-length alpha 0.821 vs snippet-length alpha 0.668 (penalty 0.153). Arm C (ko) is snippet-length and must be read through this penalty.

## RQ2 — perceptual efficacy (independent judge panel)

AI-likeness is 0-100; a NEGATIVE delta means the rewrite reads less AI-like.

| arm | class | n | judge before | judge after | delta (95% CI) | Cliff delta | "AI" call: orig -> rewrite |
|---|---|---:|---:|---:|---|---:|---|
| A | ai | 7 | 70.5 | 56.3 | -14.2 [-24.5, -5.7] | -0.429 | 76.9% -> 61.5% |
| A | human | 7 | 13.6 | 10.6 | -2.9 [-7.4, 1.4] | -0.061 | 0.0% -> 0.0% |
| B | ai | 7 | 66.1 | 43.9 | -22.1 [-35.2, -9.4] | -0.633 | 71.4% -> 46.2% |
| B | human | 7 | 26.8 | 13.4 | -13.4 [-28.7, 0.0] | -0.224 | 21.4% -> 0.0% |
| C | ai | 8 | 76.5 | 58.9 | -17.6 [-32.3, -6.4] | -0.734 | 87.5% -> 68.8% |
| C | human | 8 | 20.0 | 15.9 | -4.1 [-11.3, 0.3] | -0.266 | 6.3% -> 0.0% |

**H2a (Arm A, AI texts): SUPPORTED** — mean judge delta -14.2, 95% CI [-24.5, -5.7] lies entirely below 0.

### Anti-circularity check (pre-registered)

Independent-judge delta -14.2 vs patina internal signal delta -28.5 (n=7).
**Verdict: no gaming signature** — the internal drop is not decoupled from the independent-judge drop.

## RQ5b — collateral damage on human writing

Rewriting human text moved judge AI-likeness by -2.9 [-7.4, 1.4] and its "AI" call rate from 0.0% to 0.0%. A rise here means patina makes human prose read MORE machine-like — the real-usage failure mode.

## RQ4 — humanizer fingerprint (Arm A, deterministic style space)

Mean pairwise style cohesion: rewrites 0.9635 (n=8) vs human controls 0.9053 (n=8); gap 0.0582, permutation p = 0.078.

**H4: no significant convergence** — rewrites are no more stylistically alike than human texts are to each other.

_Small-n pilot estimate; the style vector is 6 deterministic features (sentence length, burstiness, TTR, comma density, dash/colon/semicolon density, token length)._

## Surviving cues (judge free-text, rewrite condition)

- (1×) formulaic thematic structure
- (1×) generic corporate-essay structure with topic-sentence paragraphs and abstract noun stacking
- (1×) evocative metaphors and personification
- (1×) conversational contractions and idiomatic phrasing
- (1×) specific institutional anchoring (Kenyon College, Class of 1998) with personal narrative texture
- (1×) highly specific personal anecdotes and names
- (1×) specific, idiosyncratic personal anecdotes with named individuals and unconventional career paths
- (1×) neatly resolved thematic ending
- (1×) specific, character-driven dialogue with distinct voices and subtext (unspoken social dynamics, individual temperaments, concrete setting details like 'Welsby's fixed stare' and 'sprawling oak') that 
- (1×) period-specific vocabulary and idioms
- (1×) vivid, idiosyncratic physical description and period-specific voice
- (1×) ironic concluding meta-commentary
- (1×) overly polished attribution tags and balanced-quote scaffolding
- (1×) informal editorial asides
- (1×) irreverent parenthetical asides and tonal voice

## Sensitivity — excluded register put back

| analysis | Arm A alpha | Arm A ai-delta (95% CI) | n |
|---|---:|---|---:|
| primary (excl. spok) | 0.821 | -14.2 [-24.5, -5.7] | 7 |
| sensitivity (incl.) | 0.807 | -16.8 [-26.8, -8.1] | 8 |

Both verdicts survive the exclusion, so the headline does not rest on it.
