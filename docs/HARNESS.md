# Patina measurement & quality harness

A map of every measurement, calibration, and gate tool in the repo: what it is,
whether it is deterministic or LLM-backed, the command, and where the detailed
docs live. This is an **index** — each tool documents itself in the linked file.

> For the **runtime** axis — which engine lane (deterministic substrate vs
> persona/LLM) owns each mode and module, and the invariants binding them — see
> [`docs/ARCHITECTURE.md`](ARCHITECTURE.md). This file is the **tooling** axis
> (measurement / calibration / gate commands).

Two rules govern everything here:

- **The analysis layer stays deterministic and LLM-free.** `src/features/*`,
  scoring, and every tool in the "Deterministic" rows below run with no model
  call, no API key, and no network, so they are reproducible and CI-safe.
- **Private text never gets committed.** Calibration tools may read local/private
  corpus rows (`artifacts/rebaseline-2025/{*.local.jsonl,private/*.jsonl}`,
  gitignored) but only ever emit aggregate metrics and hashes.

## Architecture

```text
CONVENTIONS  (how to contribute — governs everything below)
  CONTRIBUTING.md (patterns / signals / fixtures / versioning) · this file (map)
  AGENTS.md (src/features = deterministic, LLM-free) · TRANSLATIONESE-KO (advisory rule)
        │
        ▼
INPUT          ENGINE (deterministic, LLM-free)                 SURFACES
 text ──► src/features/* → analyzeText() → per-paragraph    ──► Node CLI (src/)
              stylometry · lexicon · ko-diagnostics ·            /patina skill (SKILL.md)
              ending-monotony · discourse-tells                  playground (browser)
                       │  HOT? = OR(signals)                          ▲ node↔playground
                       ▼  measured by                                   parity test
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ HARNESS                                                                    │
  │  (1) regression (det.)   benchmark · benchmark:ranges · benchmark:report   │
  │  (2) calibration (det.)  signal-impact · rebaseline:score/report ·         │
  │                          low-fpr · katfish-ko · lexicon:freshness          │
  │  (3) robustness/perf     robustness · perf                                 │
  │  (4) LLM quality (opt-in) quality:live · quality:rewrite-ab · adversarial-mps │
  │  (5) comparison (det.)   detector-comparison                               │
  └──────────────────────────────────────────────────────────────────────────┘
                       │  enforced by
                       ▼
  GATES (CI / pre-publish, deterministic)
   lint · test · release:check · check:no-private-assets · prose-score
```

Hot decision = OR of the per-paragraph signals (`burstiness_low`, `mattr_low`,
`lexicon_hot`, `ko_diagnostics`, `candor`, `thematic_break`, `ko_ending_monotony`)
plus the document-level `markup_leakage` / `structural_model`. The signal-impact
harness below ablates each one to report its marginal contribution.

## Quality & regression (deterministic, CI-safe)

| Tool | Command | What it measures | Docs |
|---|---|---|---|
| Suspect-zone benchmark | `npm run benchmark` | 49-fixture hot/cold accuracy, ROC/PR-AUC, F1, confusion — the regression guard | [tests/quality/README.md](../tests/quality/README.md) |
| Benchmark report | `npm run benchmark:report` | Refreshes `docs/benchmarks/latest.{md,json}` + ranking diagnostics | [benchmarks/README.md](benchmarks/README.md) |
| Regression ranges | `npm run benchmark:ranges` | Pins per-fixture CV/MATTR/lexicon expectations | [tests/quality/README.md](../tests/quality/README.md) |
| Signal impact / ablation | `npm run benchmark:signal-impact` | Per-signal **marginal** catch/FP contribution on a labeled manifest — use when adding/tuning a deterministic hot signal | this file (below) |
| Robustness | `npm run benchmark:robustness` | Adversarial detection robustness | `scripts/robustness-report.mjs` |
| Performance | `npm run benchmark:perf` | Deterministic analyzer speed (report-only) | `scripts/perf-report.mjs` |
| Detector comparison | `npm run benchmark:compare` | Offline/manual third-party detector comparison | [benchmarks/README.md](benchmarks/README.md) |

## Claim calibration (deterministic; needs the private corpus)

| Tool | Command | Purpose | Docs |
|---|---|---|---|
| Rebaseline summary | `npm run benchmark:rebaseline` / `:report` | Validates the public manifest + computes the headline catch/FP claim | [tests/quality/README.md](../tests/quality/README.md) |
| Rebaseline score | `npm run benchmark:rebaseline:score` | Re-runs the analyzer over private rows → public scored manifest (predicted_hot + trigger_counts) | [tests/quality/README.md](../tests/quality/README.md) |
| Low-FPR metrics | `npm run benchmark:rebaseline:low-fpr` | TPR@1%/5%FPR operating points | `scripts/rebaseline-low-fpr-report.mjs` |
| KatFish calibration | `npm run benchmark:katfish-ko` | KO diagnostic catch/FP deltas (aggregate-only) | [tests/quality/README.md](../tests/quality/README.md) |
| Lexicon freshness | `npm run lexicon:freshness` | AI-lexicon provenance sidecar check | `scripts/lexicon-freshness.mjs` |
| FP fixture export | `node scripts/fp-fixture-export.mjs` | Turns FP reports into suspect-zone fixtures | `scripts/fp-fixture-export.mjs` |

## LLM-backed quality (opt-in, non-deterministic, may incur cost)

| Tool | Command | Purpose | Docs |
|---|---|---|---|
| Live rewrite quality | `npm run quality:live` (`PATINA_LIVE=1` to call a model) | before/after AI score, MPS, fidelity on rewrites | [tests/quality/README.md](../tests/quality/README.md) |
| Adversarial MPS | `npm run quality:adversarial-mps` | Guards against MPS hiding unchanged AI style | [tests/quality/README.md](../tests/quality/README.md) |
| Rewrite A/B | `npm run quality:rewrite-ab` (`--live`) | Compares two rewrite configs (default `single` vs `ouroboros` multi-pass) on the same fixtures: after-AI/MPS/fidelity/edit-churn + per-fixture winner. Answers "does the multi-pass pipeline rewrite better?" | [tests/quality/README.md](../tests/quality/README.md) |

## Gates (deterministic, run in CI / pre-publish)

| Tool | Command | Purpose |
|---|---|---|
| Lint | `npm run lint` | syntax + eslint + tsc + cspell |
| Tests | `npm test` | unit + e2e (`node --test`) |
| Release metadata | `npm run release:check` | version sync across all version-bearing surfaces |
| Private-asset leak | `npm run check:no-private-assets` | no private/vendor text in the npm tarball or tree |
| Prose score gate | `patina-score` / `npm run badge` | hot-paragraph ratio CI gate (default 30) |

## Signal impact harness (`scripts/signal-impact.mjs`)

Reproducible answer to "what does deterministic hot signal X buy us, and at what
false-positive cost?" — the question every new `src/features` signal must answer
(see [CONTRIBUTING.md → Adding a Deterministic Detection Signal](../CONTRIBUTING.md)).

```bash
# Full per-signal ablation table on the KO manifest (default)
npm run benchmark:signal-impact

# One signal's marginal contribution as JSON
npm run benchmark:signal-impact -- --ablate ko_ending_monotony --json

# Another manifest / language / explicit text source
npm run benchmark:signal-impact -- --manifest artifacts/rebaseline-2025/manifest.en.scored.public.jsonl --lang en
```

It joins a labeled manifest (`expected_hot`) to its local text, runs
`analyzeText()` once per row, then recomputes the document hot verdict with each
signal ablated. For each signal it reports:

- **attributable TP / FP** — rows the signal *alone* keeps hot (no other signal
  fires): the catch it adds and the false positives it costs.
- **Δrecall / Δfpr / ΔF1** — the metric delta versus removing the signal.

`recomputeHot()` mirrors the OR rule in `analyzeText`, so `PARAGRAPH_SIGNALS` /
`DOCUMENT_SIGNALS` in the script must be kept in sync when a hot disjunct is
added or removed (a unit test pins the signal list).

## AI-tells corpus baseline (deterministic)

- **Tool:** `scripts/ai-tells-corpus-baseline.mjs`
- **Kind:** deterministic, measurement-only (no LLM, no analyzer mutation).
- **Command:** `node scripts/ai-tells-corpus-baseline.mjs --json --no-timestamp --strict`
- **What:** runs `analyzeText()` over the persona-calibration corpus
  (sycophancy 298 / tells 85 / human-controls 7) and reports confusion metrics,
  Wilson intervals, detector-signal fires, and `term_family_coverage`.
- **Drift guard:** `--strict` asserts exact counts (298/85/7); any drift fails.
- **Privacy:** output is hash/id/aggregate only; raw corpus + human-control
  bodies (`human-controls/raw/`, gitignored) are never emitted. n=7 FP is
  smoke-only, never a hard gate or public FPR claim.
- **Test:** `tests/unit/ai-tells-corpus-baseline.test.js`

## Negative controls (human FP) expansion policy

- The human-controls set (`artifacts/persona-calibration-2026/human-controls/`) is
  **smoke-only**: n=7 cannot bound FPR (0/7 still ~35% Wilson upper). See its
  `README.md` for the expansion procedure.
- The harness discovers every `human-controls/*.jsonl` and language-tags rows
  from the filename (`ko.jsonl`->ko, `en.jsonl`->en). In smoke/non-strict mode it
  reports human-control FP with a Wilson interval and absorbs added rows/files
  automatically. `--strict` is an exact-count drift guard locked at the committed
  298/85/7; promoting an expanded negative set into strict requires updating
  `EXPECTED_COUNTS` via a separate consensus (see human-controls/README.md).
- Raw bodies stay in `human-controls/raw/` (gitignored); CI reports them as
  `not_evaluated`. A hard FP threshold / public FPR claim requires a separately
  reviewed, expanded negative set — not this smoke set.

## Detector candidate evaluation (Phase B, deterministic)

- **Tool:** `scripts/detector-candidate-eval.mjs` (+ `tests/unit/detector-candidate-eval.test.js`).
- **Kind:** deterministic, measurement-only. Evaluates CANDIDATE structural/density
  hot signals against pre-registered denominators (corpus slices + suspect-zone
  fixtures) WITHOUT wiring them into `analyzeText`.
- **Promotion rule:** a candidate becomes a real hot disjunct only if
  `attributable_TP > attributable_FP` AND it adds 0 new benchmark-natural FP AND
  0 new human-control FP.
- **Current outcome (evidence):** ruleOfThree / decorativeStructure / emojiPerItem
  all score attributable_TP=0 (the recall hole is short chat-style phrases that
  carry no document structure), so **none is promoted and the deterministic
  detector is left unchanged**. The suspect-zone benchmark already classifies
  AI fixtures at recall 1.0 with 0 FP, so there is no committed recall headroom
  there either. The human-control FP (5/7) is the pre-existing burstiness signal
  (a precision matter), not something new hot signals should chase.
- **Advisory boundary:** `translationese`/`koPostEditese` remain advisory and are
  not folded into `hot`; a regression test pins this.
- **Command:** `node scripts/detector-candidate-eval.mjs --json --no-timestamp`

## Phase D: packaging + report-only corpus scripts

- **Packaging fix:** `personas/` is now in package `files`, so built-in personas
  (incl. `personas/ko/natural-ko.md`) ship in the npm artifact. `npm pack`
  includes all six KO personas; `tests/unit/persona-packaging.test.js` guards it.
- **Report-only scripts:** `npm run benchmark:ai-tells-baseline` and
  `npm run benchmark:detector-candidates` expose the Phase A/B harnesses. They
  are measurement-only and read the (unpublished, git-tracked) calibration
  corpus; they are not wired into any blocking CI gate. A hard detector/FP
  threshold stays deferred until the negative controls are expanded (Phase A2).
