# Korean translationese (번역투 / calque) detection

`src/features/translationese.js` adds a deterministic, auditable signal for
Korean **calques** — grammatical Korean that reads as translated-from-English.
The stylometry + AI-lexicon signals catch *structure* and *AI vocabulary*; they
do **not** catch lexical translationese (e.g. "커맨드 기둥" for "command pillars",
"~에 의해" passives, "당신" for "you"). This catalog fills that gap.

## Design notes

- **Precision first.** Most of these constructions also appear in good native
  Korean (formal/technical prose especially). So the signal is **density-gated**:
  it only reports `hot` when both an absolute floor (≥4 hits) **and** a
  per-prose-sentence density (≥0.5) are met. A single "~에 의해" means nothing.
- **Advisory, not a verdict.** `analyzeText` surfaces it as `translationese`
  but deliberately keeps it **out of the document `hot` decision**, so it cannot
  regress benchmark false positives. SKILL, prompt, audit, and browser surfaces
  may show it as editing context only; they must not treat it as a score, gate,
  severity, benchmark, or authorship signal.
- **ko-only** for now (calques are language-specific).
- Each rule ships a `before → after` example (enforced by a unit test).

## Catalog (before → after)

| id | tell | before | after |
| --- | --- | --- | --- |
| `noun-calque` | 직역 명사구 (pillar/layer 류) | 세 가지 **커맨드 기둥**을 설치합니다. | 핵심 커맨드 세 가지를 설치합니다. |
| `dummy-subject` | 가주어 "그것은/이것은" (it is) | **그것은** 매우 중요하다. | 매우 중요하다. |
| `direct-address-you` | "당신" 직접 호칭 (you) | **당신은** 이것을 설정할 수 있습니다. | 이건 설정할 수 있다. |
| `passive-e-uihae` | "~에 의해" 피동 (by-passive) | 작업은 에이전트**에 의해** 처리됩니다. | 에이전트가 작업을 처리합니다. |
| `have-overuse` | "~을 가지고 있다" (have) | 이 도구는 유연성을 **가지고 있습니다**. | 이 도구는 유연합니다. |
| `one-of` | "~중 하나" (one of the) | 가장 빠른 도구 **중 하나입니다**. | 손꼽히게 빠릅니다. |
| `provides` | "~을 제공합니다" (provides) | 다양한 기능을 **제공합니다**. | 여러 기능을 쓸 수 있다. |
| `as-follows` | "다음과 같습니다" (as follows) | 사용법은 **다음과 같습니다**. | 사용법은 이렇다. |
| `make-easy` | "~하게 만들어 준다" (make it ~) | 설치를 쉽게 **만들어 줍니다**. | 설치가 쉬워진다. |

## Output shape

```js
analyzeText(text, { lang: 'ko' }).translationese
// → { count, density, sentences, byRule:[{id,label,strong,count,example}],
//     hits:[...], hot, thresholds:{count,density} }
```

```js
analyzeText(text, { lang: 'ko' }).koPostEditese
// → { schema:'koPostEditese.v1', lang:'ko', analyzed, skipReason,
//     paragraphCount, sentenceCount, eojeolCount,
//     metrics:{ lexical, endings, interference, rhythm },
//     paragraphs:[{ id, sentenceCount, eojeolCount, metrics }] }
```

`koPostEditese.v1` is a Korean-only advisory payload for post-edited machine
translation texture. It exposes raw counts and ratios so an editor can inspect
literal pronouns, by-passives, light verbs, repetitive endings, suffix/rhythm
patterns, and related Korean surface features. It is **not calibrated evidence**:
callers must not treat these raw metrics as an authorship verdict, benchmark
claim, score input, gate input, severity band, percentile, or baseline-derived
finding. Audit surfaces may show the payload in a separate editing-hint section
only; they must not mix it into deterministic severity rows.

## Phase 4 calibration protocol / approval boundary

Phase 4 is a calibration and decision-report protocol only. It can measure whether
`translationese` or `koPostEditese.v1` correlates with Korean editing needs, but
it cannot by itself authorize coupling. Any future coupling to score, `hot`,
gates, severity, prompt/rewrite gates, benchmark pass/fail, or authorship
language requires a separate product/spec decision and separately approved
execution plan after the evidence package below is complete.

Required calibration package:

- **Corpus strata:** balanced Korean native-human controls, acceptable human
  translation/post-edit controls, raw machine-translationese samples, LLM Korean
  drafts, post-edited LLM drafts, and patina rewrite before/after pairs across
  blog, docs, marketing, academic/professional, forum/community, technical, and
  short-form UI/help genres.
- **Labels:** each item needs source/provenance, domain, length bucket, register,
  translation/editing status, and blinded human labels for `needs_korean_edit`,
  `translationese_present`, `post_editese_present`, and
  `meaning_preservation_risk`. Use at least two Korean-proficient reviewers with
  adjudication and agreement reporting.
- **Metrics:** report precision/recall/F1 for the labels above, false-positive
  rate on native-human and acceptable-human-translation controls,
  genre-stratified and short-text false-positive rates, confidence intervals,
  and representative wins/failures. If a separately approved offline prompt or
  rewrite experiment is proposed, its report format must also include human
  preference, MPS/fidelity regression, and edit churn.
- **Ablations:** measure translationese only, `koPostEditese.v1` only, combined
  signals, raw counts versus normalized ratios, and lexical/endings/interference
  /rhythm groups independently.
- **Decision thresholds:** pre-register the minimum precision, maximum control
  false-positive rate, allowed MPS/fidelity regression bound, and minimum
  per-stratum sample sizes before looking at holdout results. Thresholds must be
  justified by holdout evidence, not by convenience on development examples.
- **Rollback rules for any later approved coupling:** coupled experiments must be
  feature-flagged or isolated; if false positives, MPS/fidelity regressions,
  browser/Node parity drift, or domain skew exceed the approved bound, disable
  the coupled behavior and keep advisory display.
- **Deliverables:** publish a corpus manifest schema, Korean editor labeling
  guide, offline experiment script/report format, representative wins/failures
  appendix, ADR template, and follow-on approval checklist. The ADR may complete
  inside Phase 4 only as advisory-only or reject-coupling. Prompt-context,
  rewrite-priority, score/gate, benchmark, or authorship-related options may be
  documented as follow-on proposals, but none may proceed without a separate
  product/spec decision and separately approved execution plan.
- **No-coupling default:** until a later approval explicitly names a coupling and
  cites completed corpus evidence, no `translationese` or `koPostEditese.v1`
  metric may feed score, `hot`, gates, severity, z-score, baseline, percentile,
  prompt gates, rewrite gates, benchmark pass/fail, or authorship verdicts.


## Limitations / next

- Calques are **lexical**; the structural stylometric classifier cannot learn
  them (proven separately). This is a rule catalog, like patina's pattern packs.
- The catalog is intentionally small and conservative; expand with corpus
  evidence and keep the density gate to protect precision.
- `koPostEditese.v1` is not wired into `hot`, scores, gates, severity, z-score,
  baselines, percentiles, or benchmark decisions. Keep it advisory unless a
  separate post-Phase4 product/spec approval explicitly authorizes a narrowly
  scoped coupling.
