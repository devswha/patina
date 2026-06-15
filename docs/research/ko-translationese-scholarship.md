# Academic grounding for patina's Korean translationese detection

This note records the scholarly concepts that patina's Korean (`ko`)
translationese and post-editese signals **operationalize**, with verifiable
citations. It exists so the Korean detection layer is traceable to established
translation-studies and machine-translation research rather than to ad-hoc
intuition.

## Honest scope (read this first)

- This document maps patina's **existing deterministic signals** to
  well-established linguistic *phenomena*. It does **not** claim that any
  individual regex or metric was derived from a specific paper, or that patina
  reproduces any paper's exact method.
- patina's Korean rules are **corpus-validated and density-gated** for precision
  (see [`TRANSLATIONESE-KO.md`](../TRANSLATIONESE-KO.md)). The literature below
  supplies the *terminology and conceptual frame*; the calibration evidence is
  patina's own.
- The signals remain **advisory only**: `translationese` and `koPostEditese.v1`
  must not feed score, the document `hot` verdict, gates, severity, baselines,
  percentiles, benchmark claims, or authorship verdicts. Any future coupling
  requires the separately approved Phase 4 calibration package in
  [`TRANSLATIONESE-KO.md`](../TRANSLATIONESE-KO.md).

## Conceptual lineage

### Translationese and the law of interference

"Translationese" — translated text that is recognizably different from natively
written text because the source language leaves "fingerprints" — was put on a
neutral, descriptive footing by Gellerstam (1986). Toury (1995) formalized the
mechanism as the **law of interference**: "phenomena pertaining to the make-up
of the source text tend to be transferred to the target text," alongside the
**law of growing standardisation**. Jakobson (1959) is the older foundation for
treating translation shifts as a linguistic object.

This is exactly what patina's `translationese` catalog targets in Korean:
English structure carried into grammatical-but-unnatural Korean (by-passives,
literal pronouns, dummy subjects, light-verb constructions, direct calques).

### Translation universals

Baker (1993) proposed **translation universals** — linguistic features typical
of translated text regardless of language pair — investigable with corpora. The
commonly cited universals are **simplification**, **explicitation**, and
**normalisation/conservatism**. These give the vocabulary for patina's
document-level Korean texture metrics (lexical variety/density, repetitive
endings, rhythm regularity).

### Post-editese

Toral (2019), *Post-editese: an Exacerbated Translationese* (MT Summit XVII; best
paper), showed that post-edited machine translation is **simpler, more
normalised, and carries higher source-language interference** than from-scratch
human translation, with **lower lexical variety and lower lexical density**.
patina's `koPostEditese.v1` payload is named for, and conceptually structured
around, this finding: its metric groups are lexical, endings, interference, and
rhythm — the same simplification / normalisation / interference axes Toral
measured, specialized to Korean surface features.

### Korean 번역투 research tradition

Korean translation studies have a dedicated literature on English→Korean
번역투 (translationese):

- 이근희 (2005), 《영-한 번역에서의 번역투 연구》, 세종대학교 박사학위논문 — a
  book-length taxonomy of English-to-Korean translationese; the analogy to
  journalese/legalese/officialese for the `-ese` suffix comes from here.
- 이근희 (2008), 「번역투 관점에서 본 번역 텍스트의 품질 향상 방안」, 《번역학연구》 —
  translationese framed as a *quality-improvement* lens, which is precisely how
  patina uses the signal (editing hints, not accusation).
- 김순영 (2012), 「영한 번역에 나타난 번역투 문장」, 《새국어생활》 22(1), 국립국어원 —
  a concrete catalog of English→Korean translationese sentence patterns
  (by-passives, pronoun literalism, formal-noun overuse) overlapping patina's
  rule set; a companion article in the same issue covers Japanese→Korean
  번역투, relevant to patina's future `ja` work.
- 이미경 (2007), 「번역투 배제를 위한 교육수단으로서 시역의 유용성에 대한 연구」 — on
  teaching away from translationese.

## Mapping: concept → patina signal

| Phenomenon (source) | patina signal | Korean example (before → after) |
| --- | --- | --- |
| Interference / by-passive (Toury 1995; 김순영 2012) | `translationese` `passive-e-uihae` | 작업은 에이전트**에 의해** 처리됩니다 → 에이전트가 작업을 처리합니다 |
| Interference / pronoun literalism (이근희 2005; 김순영 2012) | `translationese` `direct-address-you`, `dummy-subject` | **당신은** 이것을 설정할 수 있습니다 → 이건 설정할 수 있다 |
| Interference / light verb & calque (Toury 1995) | `translationese` `have-overuse`, `noun-calque`, `provides`, `one-of`, `as-follows`, `make-easy` | 이 도구는 유연성을 **가지고 있습니다** → 이 도구는 유연하다 |
| Simplification: low lexical variety/density (Baker 1993; Toral 2019) | `koPostEditese.v1` `metrics.lexical` | (document-level ratios; advisory) |
| Normalisation: repetitive endings / uniform rhythm (Baker 1993; Toral 2019) | `koPostEditese.v1` `metrics.endings`, `metrics.rhythm` | (document-level ratios; advisory) |
| Source interference index (Toury 1995; Toral 2019) | `koPostEditese.v1` `metrics.interference` | (document-level ratios; advisory) |

The `translationese` catalog operates per paragraph with a precision-protecting
density gate; `koPostEditese.v1` exposes raw document/paragraph ratios for an
editor to inspect. Neither is a verdict.

## References

- Jakobson, R. (1959). "On Linguistic Aspects of Translation." In R. A. Brower
  (ed.), *On Translation*. Harvard University Press.
- Gellerstam, M. (1986). "Translationese in Swedish novels translated from
  English." In L. Wollin & H. Lindquist (eds.), *Translation Studies in
  Scandinavia*, 88–95.
- Baker, M. (1993). "Corpus Linguistics and Translation Studies: Implications
  and Applications." In M. Baker, G. Francis & E. Tognini-Bonelli (eds.), *Text
  and Technology*, 233–250. John Benjamins.
- Toury, G. (1995). *Descriptive Translation Studies – and Beyond*. John
  Benjamins. (Law of growing standardisation; law of interference.)
- Toral, A. (2019). "Post-editese: an Exacerbated Translationese." *Proceedings
  of Machine Translation Summit XVII*, Vol. 1, 273–281.
  <https://aclanthology.org/W19-6627/>
- 이근희 (2005). 《영-한 번역에서의 번역투 연구》. 세종대학교 박사학위논문.
- 이근희 (2008). 「번역투 관점에서 본 번역 텍스트의 품질 향상 방안」. 《번역학연구》.
- 이미경 (2007). 「번역투 배제를 위한 교육수단으로서 시역의 유용성에 대한 연구」.
- 김순영 (2012). 「영한 번역에 나타난 번역투 문장」. 《새국어생활》 22(1), 국립국어원.
  <https://www.korean.go.kr/nkview/nklife/2012_1/22_0105.pdf>
