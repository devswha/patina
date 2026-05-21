# Open Issue Wave Plan

Last synced: 2026-05-21. Source of truth is GitHub issues; this file records the current execution grouping so follow-up waves do not re-triage from scratch.

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

Closed in the latest wave: #304 NamuWiki profile, via `83675bc`.

| issue | status | next action |
|---|---|---|
| #303 KO stylometry | partially implemented; 10-row hash-only web candidate manifest is scored, pilot template ready | Fill the remaining 25-row KO pilot before comparing KatFish-style spacing/comma signals against the local manifest. |

## Wave C — corpus-gated research

| issue | status | next action |
|---|---|---|
| #155 2025+ rebaseline | blocked on corpus; intake scaffold ready | Use `npm run benchmark:rebaseline:intake` for local rows, then collect ≥3 model families × ≥2 languages with n≥100 per claim cell before public catch-rate claims. |
| #160 lexicon freshness | blocked on corpus | Re-mine per-entry provenance only after the paired 2025+ corpus exists and the Korean pilot has separated lexicon lift from register false positives. |
| #157 Korean register FP | partially unblocked; scored hash-only web human-control candidates ready | Add enough academic/종결-다 controls to reach the 25-row KO pilot before loosening or tightening KO thresholds. |
| #156 adversarial MPS | blocked on evaluator set | Needs examples where MPS passes but prose remains AI-like. |
| #158 cross-judge matrix | blocked on evaluator budget | Run only after a stable sample manifest exists. |
| #159 blinded human panel | blocked on reviewer pool | Requires reviewer instructions and consent/redistribution rules. |

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
