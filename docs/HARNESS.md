# Patina measurement & quality harness

A map of every measurement, calibration, and gate tool in the repo: what it is,
whether it is deterministic or LLM-backed, the command, and where the detailed
docs live. This is an **index** — each tool documents itself in the linked file.

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
  │  (4) LLM quality (opt-in) quality:live · adversarial-mps                   │
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
