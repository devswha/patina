# Korean performance improvement handoff — 2026-08-18

> **Status note (2026-09-02, index pass):** superseded by `ko-confirmatory-verdict-20260901.md` (NOT PROMOTED) and the September 2 plan in `humanization-data-backlog.md`; retained for its external-evidence section and as input to that day's review handoff.

**Status:** research implementation complete; promotion blocked by live safety evidence.
Production remains baseline.

## Implementation status

The implementation branch adds paragraph-scoped diagnosis, a versioned Korean
structure fingerprint, detector-neutral candidate selection, native-Korean
multi-axis blind ratings, and preregistered retention fixtures. The treatment is
research-only: shipping behavior stays on the existing baseline unless
`PATINA_KO_DIAGNOSIS_RESEARCH=1` is set.

Exact number safety remains fail-closed. Polarity, causation, and entity-role
proxies are advisory until calibration demonstrates acceptable false-positive
and false-negative rates. A confirmatory promotion decision still requires the
locked 120-item corpus, complete outcome accounting, lower-tail safety,
cross-document cohesion, latency, token, and cost evidence.

The confirmatory command is cryptographically bound to the exact 120-row corpus,
its SHA-256, Korean language, and the fixed
`iterative-baseline,ko-diagnosis-v1` order. Local-agent producer/judge runs accept
only repository-owned `redistribution: repo-ok` fixtures, scorer inputs are
data-fenced, and reports expose hashed fixture references rather than source or
rewrite text.

## Decision

The next Korean improvement should not add another global rewrite instruction or
more unconditional lexical substitutions. The strongest path is:

1. run Patina's existing deterministic Korean analysis **before** rewriting;
2. use the compact diagnosis to select bounded prompt guidance without placing
   the diagnosis payload in the model prompt;
3. apply contextual structural treatment only where a structure/rhythm signal
   fired;
4. preserve unflagged prose and bound edit churn;
5. experimentally generate two candidates, discard every safety failure, then
   rank only the survivors.

This targets the current failure mode: the contextual prompt is preferred by the
judge and preserves meaning better, but changes too much of the document and
moves the deterministic Korean AI-likeness score in the wrong direction.
Detector or provenance scores remain diagnostics, never the rewrite objective.

### Fresh research-only live reruns

Two one-item `ko-blog-01` paired reruns used Kimi CLI as producer and Gemini CLI
as the independent judge. They are debugging evidence, not confirmatory
evidence:

- diagnosis payload + contextual guidance: treatment MPS was 80 points below
  baseline and fidelity was 33.3 points below baseline;
- contextual guidance without the diagnosis payload: treatment MPS was 5 points
  below baseline and fidelity was 33.3 points below baseline; both candidates
  missed the MPS floor in that stochastic run.

The full 11-fixture rerun
also failed to complete after a 120-second Gemini scorer timeout. Therefore
there is no current promotion evidence and the treatment must remain
research-only. The locked 120-item confirmatory run was intentionally not
started after these safety failures.

### 2026-08-19 completion pass

The repository apparatus now rejects model-graded rows whose scorer returned
`status: error` even when the scorer also supplied numeric fallback values.
Those rows no longer enter safety eligibility, blind preference, candidate
candidate selection, or paired-success aggregates. Promotion cost accounting now measures
candidate-serving usage only; independent judge usage is experiment overhead,
not product COGS. Candidate calls spent before a grading or production error
remain in token, latency, and cost aggregates; known exact-number violations on
error rows still count against non-regression. A judge price is no longer
required for candidate-cost evidence, and zero-dollar evidence cannot satisfy
the cost gate. Candidate input and output rates are supplied separately, and
provider-reported reasoning/cache subsets are not double-counted on top of the
prompt/completion totals. Both totals must be present and non-negative; partial
grader telemetry is merged with the tracked candidate calls instead of
discarding paid production usage. Streamed floor failures also retain the
already-computed private Korean invariant diagnostics without exposing them in
customer frames.

The locked corpus was rechecked at 120 unique Korean `repo-ok` rows with SHA-256
`23c546abd02fdf34b3df11f0427c116cd184f39ab2e23319f4b4dd2c2ce5fee3`.
Focused tests, the full 1,728-test suite, lint, the deterministic benchmark, and
dogfood pass.

Fresh one-item debugging runs could not produce new quality evidence:

- Kimi CLI returned HTTP 402 while validating subscription benefits;
- Kimi HTTP returned insufficient balance;
- OpenAI HTTP returned `insufficient_quota`;
- xAI's calibrated `grok-4.5` judge returned a monthly spending-limit 403;
- Claude CLI's OAuth session had expired and could not refresh;
- Gemini CLI timed out during scoring;
- a local 32k-context Gemma judge exceeded the 180-second scoring deadline and
  is not a scalable confirmatory substitute.

Each provider-failed run was fully accounted as `error`; none was eligible for
preference. One local 4k-context debugging run that completed produced two safe candidates
but an order-inconsistent preference; it is not valid confirmatory evidence
because the judge context was too short. The confirmatory run remains
intentionally unstarted. Production remains baseline.

## Current evidence

The 2026-08-18 Korean counterbalanced A/B used 11 fixtures. Lower deterministic
AI-likeness is better.

| configuration | mean after score | mean MPS | mean fidelity |
|---|---:|---:|---:|
| shipping baseline | **5.3** | 91.5 | 95.5 |
| `ko-contextual-v1` | 11.0 | **98.0** | **99.2** |

Among consistent blind preference judgments, `ko-contextual-v1` won **7/7**;
three fixtures were order-inconsistent. This is promising naturalness evidence,
but not promotion evidence: it is a small model-judge sample, and the
AI-likeness diagnostic regressed. The production default therefore remains the
baseline.

The public efficacy study already located the residual Korean problem at the
document level: uniform explanatory rhythm, checklist-like completeness, tidy
problem→crisis→lesson arcs, repeated opener/closer shapes, and excessive
cross-document cohesion. See
[`2026-rewrite-efficacy-study1.md`](2026-rewrite-efficacy-study1.md).

## Closed repository gap

Patina already owns most of the necessary Korean measurements:

- spacing, comma, suffix/POS-diversity proxy and ending monotony;
- translationese and post-editese diagnostics;
- burstiness, MATTR, lexicon, discourse and structural signals;
- exact number checks plus MPS and fidelity gates.

The agent-skill path already documented suspect-zone targeting. This branch
closes the hosted measurement gap by diagnosing the source before prompt
construction and selecting contextual structure guidance only for diagnosed
structure/rhythm routes. The diagnosis payload itself is not sent to the model
after live safety evidence showed that the added payload increased semantic
drift.

- which paragraph is actually suspect;
- whether its dominant defect is structure, rhythm, punctuation, translationese
  or vocabulary;
- which spans should be preserved;
- which natural paragraphs should be left alone.

The resulting feedback loop remains research-flagged until confirmatory evidence
passes every promotion gate.

## External evidence

### 1. Humanize KR / `im-not-ai`

Repository: <https://github.com/epoko77-ai/im-not-ai>

The closest Korean project uses roughly 70 Korean-specific patterns, a
`light | standard | heavy` route hint, span-targeted editing, deterministic
change-rate checks, and a separate final comparison on heavy runs. The useful
transfer is the architecture, not wholesale pattern import: Patina already
covers many of its translationese, parallelism, punctuation and ending rules.

Its self-reported 60 AI / 60 pre-ChatGPT human comparison highlights negative
parallelism (`A가 아니라 B`), comma use, `~한다` concentration and absence of
long sentences. These findings are hypothesis material, not independent proof;
the corpus is small, genre-limited and not released in full.

### 2. KatFishNet

Paper: <https://aclanthology.org/2025.acl-long.1030/>

Code/data: <https://github.com/Shinwoo-Park/katfishnet>

KatFish is a Korean LLM-text benchmark spanning essays, poetry and paper
abstracts. Its language-specific feature families are word spacing, POS n-gram
diversity, and comma frequency/position/context. In unseen-model evaluation,
punctuation features were strongest in the reported tables. These features are
valuable measurement evidence, but origin detection is not writing quality.
Patina must not optimize candidate selection against KatFishNet.

### 3. GAEJO

Repository: <https://github.com/DevMinGeonPark/gaejo>

GAEJO separates LLM transformation from deterministic Korean validation. Its
retention tests cover normalized numerals, Latin technical terms, approximation,
contrast, emphasis, possibility and related nuance classes. It is narrower than
Patina—academic slide-style Korean—but supplies useful fixtures and failure
diagnostics for strengthening Method-D preservation checks.

### 4. Style and candidate-selection systems

- `stylometric-transfer`: <https://github.com/ngpepin/stylometric-transfer>
  uses versioned JSON fingerprints, local measurement, deviation feedback and a
  compliance retry. It is a design reference only: its PolyForm Noncommercial
  license precludes direct commercial code reuse without permission.
- VietQuill: <https://github.com/ngwgsang/vietquill> exposes multiple candidates
  and separate lexical, semantic and syntactic estimators.
- TinyStyler: <https://github.com/zacharyhorvitz/TinyStyler> and its
  [EMNLP 2024 paper](https://aclanthology.org/2024.findings-emnlp.781/) use
  multiple samples, automatic filtering and style representations.
- HyPerAlign: <https://arxiv.org/abs/2505.00038> infers interpretable style
  hypotheses from a few user examples before generation. This supports an
  optional source-conditioned voice path, not a generic manufactured persona.

None of these projects provides Patina's complete meaning, number, polarity,
causation, MPS and fidelity boundary. Their ranking/filtering ideas may only run
after Patina's existing gates.

### 5. Korean datasets and research

- StyleKQC: <https://arxiv.org/abs/2103.13439> — 30,000 Korean questions and
  commands across formal/informal styles. Useful for short-form speech level and
  ending tests; not representative of essays or reports.
- KoBEST: <https://arxiv.org/abs/2204.04541> — COPA and SentiNeg tasks are useful
  templates for causation and negation metamorphic tests.
- KLUE: <https://arxiv.org/abs/2105.09680> — STS/NLI/RE provide secondary
  semantic-similarity, contradiction and entity-role challenges across formal
  and colloquial Korean.
- Lost in Literalism: <https://arxiv.org/abs/2503.04369> — shows supervised
  training data can introduce translationese and that polished references plus
  filtering unnatural examples improve naturalness. Korean-specific effect
  sizes were not established.
- Formal Korean writing system, 2024:
  <https://www.dbpia.co.kr/journal/articleDetail?nodeId=NODE11990072>, DOI
  `10.6109/jkiice.2024.28.11.1330`. This is the **verified** record. It describes
  KoBART trained on Korean SmileStyle plus RoBERTa/Daum-dictionary synonym
  recommendation, but the accessible abstract reports no numerical quality or
  fidelity result. `NODE12054291` is unrelated and must not be cited.

## Proposed implementation

### Phase 1 — pre-rewrite diagnosis, no new model calls

Compute `analyzeText()` on the source before building the hosted prompt. Convert
only bounded, non-sensitive results into a compact diagnosis:

```json
{
  "route": "lexical|rhythm|structure|mixed|clean",
  "paragraphs": [
    {
      "id": "P2",
      "signals": ["ending_monotony", "translationese:t2-by-passive"],
      "instruction": "repair these signals only"
    }
  ]
}
```

Requirements:

- do not expose this internal block in the returned prose;
- do not include provider/model identity or customer analytics dimensions;
- mark unflagged paragraphs as preserve-only;
- apply `ko-contextual-v1` only to paragraphs with structure/rhythm signals;
- use clause-level surgery for translationese and lexical-only signals;
- return the source unchanged on an explicit clean/no-op route where the product
  contract permits it.

Likely touch points:

- `src/web-rewrite-stream.js` — source pre-analysis and evidence plumbing;
- `src/web-rewrite.js` — accept a bounded diagnosis instead of
  `documentSignals: null`;
- `src/prompt-builder.js` — render trusted, language-specific diagnosis rules;
- `src/features/index.js` — reuse only; no LLM imports;
- `scripts/rewrite-ab.mjs` — add the treatment as research-only configuration.

### Phase 2 — deterministic Korean structure fingerprint

Add a small, versioned fingerprint rather than a composite “human score”:

- paragraph and sentence-length distributions;
- repeated opener/closer shapes;
- ending-class diversity and streaks;
- checklist/bullet and triadic grouping density;
- exhaustive parallel-section cues;
- problem→crisis→lesson or problem→list→summary arcs;
- translationese/post-editese counts by rule;
- edit churn and untouched-span ratio.

Store input/candidate deltas in research output and Audit JSON only when the
receipt schema is deliberately revised. Do not silently change the existing
receipt contract.

### Phase 3 — two candidates behind a research flag

For Korean experimental runs only:

1. create baseline-targeted and contextual-targeted candidates;
2. run exact number safety on both and record polarity/causation/entity-role
   proxies as advisory diagnostics;
3. run MPS and fidelity on both;
4. discard exact-number, MPS or fidelity failures before ranking;
5. rank survivors on blind-naturalness evidence, structure-fingerprint distance,
   register/persona match and edit churn;
6. keep deterministic AI-likeness as a separately reported diagnostic;
7. roll back if no candidate survives.

Start with two candidates because three multiplies hosted cost without evidence
that the third sample pays for itself.

### Phase 4 — stronger Korean retention suite

Add metamorphic fixtures that alter exactly one property at a time:

- number, date, unit or approximation marker;
- explicit negation or modality strength;
- cause/effect direction;
- entity and semantic-role assignment;
- contrast/emphasis/possibility;
- addressee relation, honorific agreement and speech level.

KoBEST and KLUE structures can inspire tests, but check dataset licenses before
copying examples. Prefer independently authored fixtures expressing the same
logical challenge.

## Evaluation and promotion gate

Pre-register the apparatus before running the larger comparison.

### Corpus

At least 120 long-form Korean items, stratified across report, email, public
document, product/marketing, review, technical explanation, column/essay and
social/blog. Keep the final test split isolated from prompt development. Add
short-form StyleKQC-like items as a separate slice, not to the long-form mean.

### Primary outcomes

- paired blind native-Korean preference;
- naturalness, register fit and clarity as separate ratings;
- exact invariant pass rate;
- MPS and fidelity;
- edit churn and untouched-span ratio.

### Secondary diagnostics

- deterministic AI-likeness before/after;
- structure fingerprint deltas;
- latency, tokens and cost;
- model/judge and item slices.

### Minimum promotion requirements

- treatment preference win-rate confidence interval excludes 50% under the
  locked confirmatory estimator;
- no regression in exact number safety; polarity, causation and entity-role
  proxies remain advisory until separately calibrated;
- the shipping MPS/fidelity floors are copied into the preregistration and
  cannot be lowered; their locked lower-tail summaries do not regress;
- no increase in cross-document house-style cohesion;
- latency and cost remain within the preregistered product budget.

The preregistration must freeze all decisive definitions before any confirmatory
output is inspected:

- confidence level, estimator and resampling/cluster unit;
- treatment of ties, abstentions, judge errors and AB/BA order inconsistency;
- the exact shipping MPS/fidelity floors and the tail quantile used for
  non-regression;
- exact-invariant acceptance (number, polarity, causation and entity roles);
- the cross-document cohesion metric, baseline and non-inferiority margin;
- latency, token and monetary budgets;
- missing-data handling, exclusion rules and stopping rule.

Deterministic AI-likeness stays in Secondary diagnostics. It cannot select a
candidate, veto promotion or determine whether an experiment proceeds.

Do not promote on mean score alone, the current 7/7 consistent subset, or the
same model acting as both producer and judge.

## Explicit non-goals

- detector bypass or detector-guided rewriting;
- translation chains through unrelated languages;
- fabricated anecdotes, quotes, citations, specifics or personal texture;
- polarity/sentiment transfer;
- unconditional punctuation or sentence-length quotas;
- replacing existing safety gates with embedding similarity or an LLM judge;
- directly copying noncommercial external code.

## Recommended execution order

1. Phase 1 diagnosis plumbing and focused tests.
2. Shadow A/B on the existing 11 Korean fixtures.
3. Add the long-form evaluation corpus and metamorphic safety suite.
4. Calibrate the fingerprint measurement-only.
5. Run the preregistered 120-item blind comparison.
6. Trial two-candidate selection only if Phase 1 improves locked native-Korean
   outcomes without a safety regression and stays within the locked budget.

This order tests the cheapest causal hypothesis first: Patina's Korean analyzer
already knows where the defects are; the hosted rewriter simply is not being
told.
