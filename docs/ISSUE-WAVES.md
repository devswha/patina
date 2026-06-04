# Open Issue Wave Plan

Last synced: 2026-05-22. Source of truth is GitHub issues; this file records the current execution grouping so follow-up waves do not re-triage from scratch.

## Wave A — launch/growth execution

| issue | status | next action |
|---|---|---|
| #286 launch tracker | ready, maintainer-owned | Post or explicitly defer each channel draft, then attach exact score output and feedback links to #286. Agents may prepare copy and score proof, but should not post from maintainer accounts. |
| #307 awesome-list discovery | ready, external-submission owned | Prepare a short candidate-list/submission checklist for relevant awesome lists; maintainer submits where external account or repo ownership is required. |

Current score proof:

```bash
node scripts/precommit-score.mjs docs/social/patina-launch-copy.md docs/social/patina-launch-korean-first.md docs/social/signs-of-ai-writing.md docs/social/signs-of-ai-writing_KR.md
```

Latest local result: launch copy 6.3%, Korean-first copy 0.0%, EN guide 0.0%, KR guide 20.0%.

## Wave B — implementable product/profile work

Closed in the latest waves: #304 NamuWiki profile, via `83675bc`; #305
one-time install/CLI star nudge; #306 first-screen README terminal demo GIF;
#308 language-suffixed README demo GIFs via `e8ba041`; #156 adversarial
MPS repo-owned 10-fixture gate; #157 KO register FP coverage gate via
`987995f`; #303 KO diagnostics calibration via the KatFish aggregate report;
#155 sanitized 2025+ rebaseline claim report; #160 lexicon freshness audit.

| issue | status | next action |
|---|---|---|

## Wave C — evaluation-gated research

| issue | status | next action |
|---|---|---|
| #158 cross-judge matrix | CLI shortcut removed during surface simplification; full matrix blocked on evaluator budget | Run 3×3×30 agreement after a stable sample set exists. See `docs/research/judge-agreement.md`. |
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

- Keep launch posts and public claims separate: launch copy can cite checked-in benchmark reports and the sanitized rebaseline report, but must not claim broader 2025+ performance than the checked-in reports support.
- Any scoring-threshold change must update benchmark ranges and dogfood evidence in the same change.
- For KO/2025+ corpus work, keep raw text in `artifacts/rebaseline-2025/` or another private store and commit only redistributable examples, hashes, metadata, and aggregate reports.
- For external-account actions (HN, Product Hunt, Reddit, X, Threads, LinkedIn), prepare copy and evidence; the maintainer posts or explicitly delegates posting.
