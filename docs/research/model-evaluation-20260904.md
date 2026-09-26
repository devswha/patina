# Provider model evaluation protocol

Recorded 2026-09-04 UTC before scorer or rewrite outcome collection. Canary
responses only establish access. They do not rank model quality.

## Questions and scope

Which available model works best for Patina rewriting, and which works best as
its scorer? Compare models within each provider and report transport differences
when comparing providers. The accompanying JSON locks the requested IDs, routes,
reasoning settings, unavailable providers, and source inventory.

Gemini uses only the loopback OpenCodex proxy and explicit
`google-antigravity/gemini-*` models. No API-key or CLI fallback is permitted.
OpenAI uses OpenCodex; Anthropic uses a logged-in native Claude CLI with tools
disabled; DeepSeek and Kimi use their configured API accounts. Subscription
access is not zero marginal cost evidence and cannot establish hosted API cost.

## Scorer study (#412)

- Exercise the production `src/scoring.js#scoreText` path on all 49 current
  suspect-zone regression fixtures (KO, EN, ZH, JA), with no fake LLM score.
- Record each loaded pattern pack's score distribution, final and raw LLM score,
  deterministic score, language/class, text hash, effective model, usage, latency,
  transport errors, and schema failures. Keep failures separate from valid zero.
- One pass screens candidates. For each provider, repeat the two candidates
  with the highest valid-output rate, then ROC-AUC, then lower median latency,
  twice more. Report those selection rules and the selection bias.
- AUROC/PR-AUC describe these fixture labels only. No authorship claim, production
  threshold change, or CI gate follows from the live results.
- The harness also accepts a hash-bound manifest plus local text file. Private
  raw inputs, matched phrases and judge rationales never enter public output.

## Rewrite study

- Screen every admitted candidate on the same 12 fixtures: KO/EN email, how-to,
  marketing, social; plus the first two AI fixtures in each of ZH/JA. ZH/JA
  fixture authorship labels are synthetic regression controls, not a real-world
  validation corpus.
- Use the production compact rewrite prompt, no Persona, and the fixture's
  Document Type. Preserve source voice. No candidate-specific prompt tuning.
- Record delivered output, source/output/prompt hashes, generation time, tokens,
  error rate, and deterministic number-safety findings. Raw outputs stay private.
- Judge with two independent families, excluding the candidate's family. Fixed
  seats: OpenAI GPT-5.5, Gemini 3.7 Flash through OpenCodex, Claude Sonnet 5.
  Non-panel families use GPT-5.5 and Gemini 3.7 Flash. Hide provider/model IDs.
- Each judge runs production MPS and fidelity checks plus a separate naturalness
  rubric. Naturalness means clear idiomatic prose suited to the document's
  audience, with varied but purposeful structure and no canned AI packaging.
  Score 0–4, where 0 is unusable, 1 poor, 2 mixed, 3 natural, 4 very natural.
  This is model judgment; it does not replace the actual human panel (#159).
- A safe output requires no number-safety failure, and MPS ≥90 and fidelity ≥90
  from both judges. Rank within each provider by safe-output rate, then median
  naturalness, then median generation latency. Errors count against the rate.
- Repeat the best two candidates per provider on all 22 KO/EN live-quality
  fixtures plus all 12 ZH/JA AI fixtures, three independent repeats. Report
  per-language results, failures, and spread; ties or overlapping evidence may
  remain inconclusive. No production model changes are implied.

## Reliability and reporting

Measurement amendment, before any valid rewrite collection: the initial scorer
pilot was invalidated after independent review found raw-schema and journal
defects. A local-only record
(`artifacts/model-evaluation-20260904/pilot-invalidated.json`, not committed)
records the stop; those rows cannot select finalists or support recommendations. Validated
runs use a new output directory after the corrected harness passes review.

Raw scores must have numeric bounded values and only known pattern-pack keys.
MPS anchor verdicts, counts and the computed score must agree; fidelity criteria
must be integers from 0 to 3 before production normalization. Safe rewrites also
require zero HARD_FAIL anchors. Pattern/config/code hashes and full fixture
identities bind resume. Every completed call is written to a private atomic
receipt before another call starts, and each writer owns an exclusive lock.
Unobserved in-flight calls remain unresolved, never silently repeated.

Requests have bounded deadlines. One provider runs one request at a time; study
workers have distinct output files. Every terminal attempt is appended before
continuing. Resume skips recorded attempts; it never silently replaces failures
with successful retries. A changed corpus, configuration, or protocol needs a
new output directory. Missing access stays missing.

Report each provider's rewrite choice, scorer choice, fast alternative, exact
model and transport, measured quality/latency/usage, evidence limits, and any
unresolved comparison. Groq, Together and MiniMax need account access before an
experimental recommendation can be made for them.

Storage amendment (2026-09-05): bind a new output directory to its protocol before
the first request. A failed attempt-receipt write aborts transport retries and
the worker. Existing unbound directories require an explicit receipt audit;
they are never silently rebound. Already-running frozen collectors retain their
source snapshot. Audit their terminal receipts before using their results, and
record the source/protocol boundary for later cohorts. These storage guards do
not change scoring, rewrite prompts, judge rubrics or finalist selection rules.
