# Correction: the deepseek-0731 failures were a measurement artifact (2026-08-03)

> Corrects the verdict of the first 2026-08-03 deepseek-0731 run and its
> root-cause addendum; this record supersedes their conclusions. Pattern
> note: this is the same failure class as the July register-failure saga —
> the apparatus, not the engine.

## What was wrong with the first run

The 15/22 run disabled DeepSeek reasoning (`thinking: {type: "disabled"}`) to
match the July cost point. The shipped gemini-3.6-flash baseline runs with its
default (low) reasoning. That asymmetry caused the failures: with thinking
off, 0731 drifts on the `[BODY]`/`[SELF_AUDIT]` output contract (audit
leakage, orphan tags) and, in one case, fabricated a supporting claim. With
thinking at its default, all four inspected deliveries came back clean — no
tag leakage, no fabrication, dropped claims restored.

## Thinking-on rerun: 20 pass / 2 warn / 0 error

Same 22 fixtures, same fixed judge (`gpt-5.5` via codex-cli), same prompt
path; only the thinking override removed.

| | gemini-3.6-flash (2026-07-27) | deepseek-v4-flash-0731, thinking on |
|---|---:|---:|
| pass | 20/22 (2 fail) | **20/22 (2 warn, 0 error)** |
| worst MPS | 80 | 80 |
| worst fidelity | — | 91.7 |
| ai_not_improved | 2 | 2 (`en-social-01` −1.8, `ko-email-01` −0.1; both near-clean sources) |
| approx cost / rewrite | $0.030 | ~$0.004 (reasoning tokens included; still ~8x cheaper) |
| latency / rewrite | ~8s | **~60–90s** (reasoning-dominated) |

Both warns are the borderline "source already scores low, rewrite does not
improve it" class — the same evasion-adjacent shape the July analysis treated
as tolerable at 2/22 for the shipped engine.

## Corrected verdict

- Quality: with default thinking, 0731 **matches the shipped engine** on this
  gate — the July meaning-gutting and the August contract/fabrication findings
  are both apparatus-resolved or model-resolved.
- The real remaining tradeoff is **latency**: ~60–90s per rewrite versus ~8s.
  For the streaming playground UX this is user-visible waiting, and the
  free-tier hourly burst window compounds it. Cost favors 0731 ~8x.
- Caveats before any provider decision: this is **n=1 per fixture** and the
  harness itself documents ±20 MPS swing between identical runs — a swap
  candidate needs `--repeat` validation; DeepSeek bills output 2x at announced
  peak hours (policy announced, date TBA), which moves the cost figure; and
  the v6.4 hold freezes provider defaults, so any change goes through the
  frozen-default process.

## Options this opens (owner decisions, not taken here)

1. **Free tier on 0731 (thinking on)**: cuts free-tier burn ~8x and decouples
   it from the Gemini spend cap; latency is more tolerable for a free tier.
2. **Pro on 0731**: only after repeat-validated quality and a latency call —
   a paying user waiting 60–90s is a product regression even if quality ties.
3. **Status quo** pending the Gemini cap fix, re-measuring on DeepSeek's next
   update or the peak-pricing activation.

## Addendum (2026-08-03): the reasoning dial, measured

Latency anatomy on `ko-news-01` (prompt ~22.8k tokens, 99.9% cache-hit): the
API decodes at ~125 tok/s; the time goes to reasoning volume, not transport.
`budget_tokens` is ignored by the API; `reasoning_effort` works.

| thinking | reasoning tokens | latency/rewrite | 22-fixture result |
|---|---:|---:|---|
| disabled | 0 | ~4s | 15 pass — contract violations + fabrication (retracted run) |
| `reasoning_effort: low` | ~5.3k | ~44s | **20 pass / 0 warn / 2 error** (both `mps<70`: en-marketing 66.7, ko-marketing 50) |
| default | ~11.5k | ~60–94s | 20 pass / 2 warn / 0 error |
| gemini-3.6-flash (shipped) | its default | ~8s | 20 pass / 2 fail |

Production context: the shipped gemini rewrite call also runs full reasoning —
`scoringExtraBody` cuts reasoning only on the MPS/fidelity judges, and the
rewrite call is excluded because reduced thinking measurably amputated
content. The effort-low DeepSeek result rhymes with that lesson in a milder
form: both failures are meaning drops, concentrated in the marketing register,
one (66.7) within the harness's documented ±20 MPS single-run swing.

Cache behavior is a strength, not a risk: the patina prompt's fixed 22k-token
pattern/persona prefix hits DeepSeek's automatic prefix cache at ~99.9%
($0.0028/M on hits; a cold miss costs ~$0.003 once). Deploys that change
pattern files reset the prefix, which is expected and cheap.

Standing options update: the free-tier candidate settings are effort-low
(~44s) or default (~60–94s); either needs `--repeat` validation before a
swap, per the harness's own noise bound.
