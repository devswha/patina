# Scorer-path corpus intake, 2026-09-05

The September 5 work for issue #643 produced an offline intake of 85 unique
texts and an audit of the evidence behind them. There are no authenticated human authorship labels,
human polish ratings, or human-edited AI pairs in this intake. The owner
cancelled the remaining study on 2026-09-08; #643 is closed `not_planned`, not
deferred or completed. Existing results and tools are retained as history.
Resuming requires a new explicit request; no corpus metric becomes a CI gate.

The [JSON summary](scorer-path-corpus-20260905.json) contains counts, diagnostic
results, hashes and an optional generation plan. Texts, prompts, source records
and call receipts stay in the private bundle. None are copied into this report.

## Evidence and selection

The generation source is the frozen evaluation checkout at
`8918cd015fc71b35d0b7855cfe7625eb7a050fcf`. Its Astra and Terra directories each
contain 34 sources × 3 repeats. All 204 generation records passed the audit:
the source and rebuilt prompt hashes, candidate definition, request identity,
receipt ordinal, response model metadata and delivered text agree. The audit
also checks public/private record parity and complete cohort membership.
Model identity here means the identity recorded in the transport response.

The original files named `ai` are curated style fixtures. They do not prove
model authorship. Only the recorded output completions supply model-generation
provenance. Reusing those outputs does not supply human ratings or certify that
the rewrites preserved meaning.

The human source is the existing rebaseline private extraction, matched against
`human-controls.public.jsonl` and `sources.ko-public.jsonl`. All 250 candidate
text hashes and source/license metadata bindings passed. This checks the saved
records; it does not independently authenticate the author or establish current
redistribution permission. The intake keeps `generator`, human quality and
polish labels unknown. Its rights state is `needs-review`.

Selection uses whole texts, source-declared `social`, `marketing` or
`chat-update` register, and a bound of 1–500 Unicode code points. Exact UTF-8
text hashes determine deduplication and order before a 100-text cap. The cap
was not reached. Scores, judge ratings and numeric safety results never enter
selection. Nine generated occurrences with a failed numeric proxy remain.

| Selection result | Count |
| --- | ---: |
| Audited model outputs | 204 |
| Bound publisher candidates | 250 |
| Occurrences in the chosen registers and length bound | 86 |
| Exact duplicate occurrences, with both receipts retained | 1 |
| Unique model-generated texts | 35 |
| Unique publisher candidates | 50 |
| Total unique texts | 85 |

The generated texts come from six source fixtures. The 50 Korean publisher
excerpts come from eight pages and retain their inherited `chat-update` bucket.
They are article excerpts, not authenticated SNS controls. Repeats and excerpts
from one source are dependent; these counts do not justify independent-row
confidence intervals. HAP-E's existing human rows were inspected separately:
none of its 8,290 human rows is at most 500 characters. No passages were cropped
to manufacture short controls.

## What the scorer diagnostics establish

The run uses the scorer code at `722d814925312c8859f1c6499860597d8ce41482`, with
the loaded configuration, pattern and lexicon hashes recorded in JSON. No
private structural model was loaded. It runs the deterministic scorer and
`reconcileScoreOverall` with a hypothetical LLM overall of zero. It does not
call `scoreText` through a provider or substitute that zero for an observed
model score.

| Diagnostic cohort | Exact zero at LLM zero | Below 30 at LLM zero |
| --- | ---: | ---: |
| All generated texts | 34/35 | 35/35 |
| Generated social texts | 12/12 | 12/12 |
| Publisher candidates, authorship unknown | 50/50 | 50/50 |

These are descriptive score counts. Generation origin alone does not label a
text as polished or tell-positive, and a source URL does not establish a human
negative. The qualified exact-zero, FNR, human FPR and recall metrics therefore
remain null. The diagnostic cutoff of 30 is recorded for inspection; it is
not a validated operating threshold for this corpus.

Only two generated English marketing texts meet the current short-form tell
eligibility rules. None of the 12 generated social texts does. The intake's
500-character bound is broader than the detector's English social/marketing
limit of 200 non-whitespace characters and four prose sentences.

All three unique social/marketing texts with a native single em dash receive
one derived comma variant. Their original-minus-variant score deltas at LLM
zero are **1.4, 0, 0**. The two zero deltas are outside short-form eligibility;
they remain in the result. These are punctuation experiments with no human
meaning review. They do not become human edits or gold counterfactual labels.
No skipped row discarded its evidence floor. Multiple-dash, arbitrary versus
genuine triad, combined-tell and reviewed context-exclusion coverage is still
missing.

## Private bundle and reproduction

The delivered bundle is
`/tmp/patina-scorer-path-corpus-20260905/frozen-intake`. Its parent and the bundle
contain `.gitignore` files with `*`. Bundle directories use mode 0700 and files
use 0600. A new output directory is required; existing files are not replaced.

The bundle holds `intake.private.json`, `diagnostics.private.json`,
`counterfactuals.private.json`, `source-index.private.json`, `summary.json` and
283 content-addressed evidence files. Every retained text keeps its source,
license record and receipt bindings. Duplicate texts retain every occurrence's
evidence. Public hashes bind the intake, including the exclusion ledger, and
its diagnostic and counterfactual observations.

```bash
node scripts/research/scorer-path-corpus.mjs \
  /home/devswha/workspace/patina-cohort-evaluation \
  /home/devswha/workspace/patina/artifacts/rebaseline-2025 \
  /tmp/patina-scorer-path-corpus-20260905/reproduction

node scripts/research/scorer-path-corpus.mjs --verify \
  /tmp/patina-scorer-path-corpus-20260905/frozen-intake \
  docs/research/scorer-path-corpus-20260905.json
```

The integrity check needs no access to the original study directories. It
checks evidence bytes, text hashes, observation hashes and the complete public
summary. The bundle supplies saved provenance evidence, not independent proof
of a publisher's authorship or permission.

## Optional parent generation plan

The plan below describes the September 5 handoff. The
[September 6 execution receipt](https://github.com/devswha/patina/issues/643#issuecomment-5559793246)
records all 12 generation calls completed, with 11 unique output hashes and
three numeric-proxy failures retained. Receipt replay made no further provider
calls. This closes the collection step, not human-label or meaning acceptance.

The JSON's `optionalGenerationPlan` freezes a small collection to address the
observed short-size gap. It requests **12 generation calls and zero additional
score/judge calls**: one source in each EN/KO × social/marketing cell, repeated
three times. The four source and prompt hashes are listed. The source fixture
IDs are `en-marketing-01`, `en-social-01`, `ko-marketing-01` and `ko-social-01`.

The candidate is the existing protocol's `gemini-3.7`, recorded as
`google-antigravity/gemini-3.7-flash` through OpenCodex. The parent owns execution.
The worker made no provider calls. Plan hash:
`3e2b51e9a55de6e25da7bdb3a2c9b49bf2c522f38c116c3da87c10b5b88cbc7a`.

The prompt asks for at most 160 non-whitespace characters and two sentences,
without forcing punctuation tells. Each request gets one transport attempt.
All 12 outcomes must be retained, including failures, overlength text and
meaning loss. No quality-based replacement, provider fallback or Gemini API
key is permitted. The request/response evidence must bind the plan, source,
prompt, repeat and actual model metadata. At handoff this plan was not an executed result
and cannot fill the missing human evidence.

## Remaining acceptance requirements

The remaining collection and evaluation work below was cancelled on September
8. These gaps describe the evidence limits, not a pending execution queue.

- Obtain authenticated human social/marketing text and reviewed sharing rights.
- Collect actual text-bound human polish, quality, register and tell labels.
  Distinguish arbitrary triads from real three-step instructions; review quote,
  code and glossary exclusions and combined tells.
- Collect human-edited AI pairs with actor/depth, source/rights and meaning
  evidence under the [edited-AI intake policy](edited-ai-intake-policy.md).
  The framework from #746 supplies validation, not the missing observations.
- Review counterfactual meaning and add independent sources to the missing
  slices. Existing repeated rewrites remain grouped by their source.
- Attach actual, exact-input, receipt-bound `scoreText` observations before
  reporting end-to-end FNR or analyzer/final-score disagreement.
- Freeze a held-out split, confidence method and operating thresholds; measure
  the human false-positive tolerance before promoting exact-zero/FNR CI gates.

## Validation

- Focused tests: 12 passed, including request/model/text tampering, deduplication,
  unknown labels, actual scorer floors, counterfactual exclusions, private
  permissions, evidence corruption and the frozen generation plan.
- Full `npm test`: 1,897 passed, two skipped, zero failures on Node v24.18.0.
- `npm run lint`: syntax, ESLint, typecheck and spelling checks passed.
- Existing analyzer benchmark: 49/49 curated fixtures, accuracy and per-language
  F1 of 1.0. Existing scorer benchmark: eight fixtures, zero failures. These
  fixture results are regression checks, not new corpus performance claims.
- Private bundle verification: 85 texts and 283 evidence files matched the
  public summary. None of the 85 private texts occurs verbatim in the four new
  public files. The report's prose score is below its gate of 30.

Logs and benchmark JSON are retained beside `frozen-intake` in the private
output root. Benchmark writes were redirected there without editing benchmark
code or writing result files elsewhere in the worktree. No threshold, pattern,
runtime scorer or core skill file is changed.
