# Open Issue Wave Plan

Last synced: 2026-05-22. Source of truth is GitHub issues; this file records the current execution grouping so follow-up waves do not re-triage from scratch.

## Wave A — launch execution

| issue | status | next action |
|---|---|---|
| #286 launch tracker | ready, maintainer-owned | Post or explicitly defer each channel draft, then attach exact score output and feedback links to #286. Agents may prepare copy and score proof, but should not post from maintainer accounts. |

Current score proof:

```bash
node scripts/precommit-score.mjs docs/social/patina-launch-copy.md docs/social/patina-launch-korean-first.md docs/social/signs-of-ai-writing.md docs/social/signs-of-ai-writing_KR.md
```

Latest local result: launch copy 6.7%, Korean-first copy 4.5%, EN guide 0.0%, KR guide 20.0%.

## Wave B — implementable product/profile work

Closed in the latest waves: #304 NamuWiki profile, via `83675bc`; #305
one-time install/CLI star nudge; #306 first-screen README terminal demo GIF;
#156 adversarial MPS repo-owned 10-fixture gate; #157 KO register FP
coverage gate via `987995f`; #303 KO diagnostics calibration via the
KatFish aggregate report.

| issue | status | next action |
|---|---|---|

## Wave C — corpus-gated research

| issue | status | next action |
|---|---|---|
| #155 2025+ rebaseline | blocked on positive/multilingual corpus; public-web KO human-control collection now has a 250-row hash-only pilot | Use `npm run benchmark:rebaseline:intake` for local rows, then collect ≥3 model families × ≥2 languages with n≥100 per claim cell before public catch-rate claims. See `docs/research/2026-rebaseline.md`. |
| #160 lexicon freshness | English remine complete; sidecar provenance in place for all lexicons | Close after confirming `npm run lexicon:freshness` and the HAP-E aggregate report. Keep KO/ZH/JA calibration as future language-specific work. See `docs/research/lexicon-freshness-audit.md`. |
| #158 cross-judge matrix | CLI judge-family warning implemented; full matrix blocked on evaluator budget | Use `--suspected-generator <family>` for score warnings now; run 3×3×30 agreement after a stable sample manifest exists. See `docs/research/judge-agreement.md`. |
| #159 blinded human panel | study design ready; panel blocked on reviewer pool | Recruit 5 raters × 30 paired samples with consent/redistribution rules. See `docs/research/human-eval-panel.md`. |

## Wave D — ecosystem/integration expansion

| issue | status | next action |
|---|---|---|
| #206 VS Code extension | parked | Needs extension scope, auth model, marketplace ownership, and shared analyzer packaging. |
| #207 Obsidian plugin | parked | Needs plugin scope and local-file privacy model. |
| #211 pattern marketplace | parked | Needs governance, signing/trust model, and pack schema stability. |
| #212 HuggingFace dataset | parked | Needs redistributable corpus rows; do not publish private/no-redistribution text. |
| #284 browser extension | parked | Needs content-script privacy model and review of store policies before implementation. |

## Operating rules

This is a queue, not a promise to post or publish. When a prerequisite is
missing, keep the issue open and point to the blocker instead of inventing a
claim.

- Keep launch posts and public claims separate: launch copy can cite checked-in benchmark reports, but not 2025+ model performance until #155 passes its gate.
- Any scoring-threshold change must update benchmark ranges and dogfood evidence in the same change.
- For KO/2025+ corpus work, keep raw text in `artifacts/rebaseline-2025/` or another private store and commit only redistributable examples, hashes, metadata, and aggregate reports.
- For external-account actions (HN, Product Hunt, Reddit, X, Threads, LinkedIn), prepare copy and evidence; the maintainer posts or explicitly delegates posting.
