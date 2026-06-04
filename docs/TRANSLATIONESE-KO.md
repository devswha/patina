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
  regress benchmark false positives. The SKILL / callers act on it (e.g. the
  rewrite loop), and the audit surface can display it.
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

## Limitations / next

- Calques are **lexical**; the structural stylometric classifier cannot learn
  them (proven separately). This is a rule catalog, like patina's pattern packs.
- The catalog is intentionally small and conservative; expand with corpus
  evidence and keep the density gate to protect precision.
- Not wired into `hot` yet — promote only after validating no FP regression on
  the benchmark / a diverse human ko control set.
