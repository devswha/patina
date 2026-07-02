# KO Lexicon Freshness Remine — 2026-07

- Source id: `ko-remine-2026-07`
- Validated at: 2026-07-02
- Method: `scripts/lexicon-freshness.mjs` (production matcher `computeDensity`) — aggregate counts only, raw corpus stays local/private.
- Corpus: **hot 840** (ko-intake 130 · ko-modern-generations 120 · KatFish essay AI 590) vs **cold 466** (web-human-controls 285 · KatFish essay human 181).
  Registers — hot: academic-summary 50, blog 50, chat-update 50, product-doc 50, technical-how-to 50, student-essay 590; cold: 56–58 per register + student-essay 181.
- KatFish: Park, Kim, Kim, Han — ACL 2025 Main (arXiv:2503.00032).
- External taxonomy cross-reference: im-not-ai 한글 AI-tell taxonomy v2.0 (D-1/D-2 결산·의의 표지, signature phrases).
- Gate (pre-registered): keep = hot_docs > 0 AND lift ≥ 4 AND cold DF ≤ 5%. New-candidate additions: hot DF ≥ 8, phrase lift ≥ 6, ≥2 registers with ≥2 hot docs, discourse-function-only curation (topic nouns and generic inflected verbs rejected regardless of lift).

## Outcome

- v1.x entries: 96 → **21 kept / 75 dropped** (20 with measured sub-gate evidence, 55 with zero corpus coverage either way).
- New entries promoted: **12** (2 strict, 10 phrase). Lexicon v2.0.0 total: **33**.
- Catalog-duplication principle revised: deterministic layer does not read pattern packs, so externally validated catalog anchors (결론적으로, 궁극적으로, 이를 통해) are now duplicated into the lexicon. See ai-ko.md header.

## Kept v1.x entries (21)

| kind | entry | hot | cold | lift | cold DF |
|---|---|---:|---:|---:|---:|
| phrase | 새로운 가능성을 | 1 | 0 | Infinity | 0.00% |
| phrase | 시사점을 제공 | 2 | 0 | Infinity | 0.00% |
| phrase | 의미가 있다 | 1 | 0 | Infinity | 0.00% |
| phrase | 자리 잡았다 | 2 | 0 | Infinity | 0.00% |
| phrase | 자리잡고 있다 | 1 | 0 | Infinity | 0.00% |
| phrase | 중요한 의미 | 3 | 0 | Infinity | 0.00% |
| phrase | 큰 의미를 | 1 | 0 | Infinity | 0.00% |
| strict | 가시화 | 1 | 0 | Infinity | 0.00% |
| strict | 꼽힌다 | 1 | 0 | Infinity | 0.00% |
| strict | 더 나아가 | 20 | 2 | 5.548 | 0.43% |
| strict | 면모 | 3 | 0 | Infinity | 0.00% |
| strict | 본질 | 44 | 4 | 6.102 | 0.86% |
| strict | 양상 | 22 | 2 | 6.102 | 0.43% |
| strict | 일환 | 7 | 0 | Infinity | 0.00% |
| strict | 자리매김 | 10 | 1 | 5.548 | 0.21% |
| strict | 자리잡은 | 3 | 0 | Infinity | 0.00% |
| strict | 차별화 | 1 | 0 | Infinity | 0.00% |
| strict | 평가된다 | 1 | 0 | Infinity | 0.00% |
| strict | 한걸음 더 | 1 | 0 | Infinity | 0.00% |
| strict | 한편으로는 | 7 | 0 | Infinity | 0.00% |
| strict | 활성화 | 23 | 3 | 4.253 | 0.64% |

## Promoted new entries (12)

| kind | entry | hot | cold | lift | cold DF | backing |
|---|---|---:|---:|---:|---:|---|
| strict | 결론적으로 | 301 | 2 | 83.492 | 0.43% | im-not-ai D-1 (KatFish-validated); ko-filler.md 앵커 중복 수록 |
| strict | 궁극적으로 | 11 | 1 | 6.102 | 0.21% | im-not-ai D-1 계열; ko-filler.md 앵커 중복 수록 |
| phrase | 이를 통해 | 185 | 2 | 51.315 | 0.43% | im-not-ai D-1; ko-language.md 패턴 7 앵커 중복 수록 |
| phrase | 중요합니다. | ? | ? | ? | 0.00% | 공허한 중요성 단정 (D-2 계열), 문말 앵커 |
| phrase | 있습니다. 또한, | 110 | 1 | 61.024 | 0.21% | 문장 경계 연결 스캐폴드 (C-11 어휘형) |
| phrase | 중요한 역할을 | 67 | 0 | Infinity | 0.00% | 의례적 콜로케이션 |
| phrase | 필요가 있습니다 | 58 | 2 | 16.088 | 0.43% | im-not-ai signature phrase |
| phrase | 있으며, 이는 | 37 | 0 | Infinity | 0.00% | 연결 스캐폴드 |
| phrase | 하나입니다. | ? | ? | ? | 0.00% | 나열 상투구 (~중 하나입니다), 문말 앵커 |
| phrase | 영향을 미칩니다. | 24 | 0 | Infinity | 0.00% | 영향 단정 상투구, 문말 앵커 |
| phrase | 가능성이 큽니다. | 17 | 0 | Infinity | 0.00% | 헤징 상투구, 문말 앵커 |
| phrase | 라고 할 수 있습니다 | 16 | 1 | 8.876 | 0.21% | im-not-ai signature phrase |

### Rejected despite passing numeric gates (curation layer)

Topic/domain nouns and generic inflected verbs were rejected wholesale even when
lift passed (e.g. 스마트폰, 교육, 미디어, 파일, 회의, 배울, 찾을): the hot corpus is
topically skewed (student essays), so these are corpus-topic discriminators, not
style tells. Promoting them would flag ordinary human writing about those topics.
Comma-attached connective forms (또한, / 하지만, / 하며,) were rejected as standalone
entries because the connective-comma signal already exists as the c11 translationese
advisory; only the cross-sentence scaffold `있습니다. 또한,` was kept.

## Dropped v1.x entries — counter-evidence or sub-gate lift (20)

| kind | entry | hot | cold | lift | cold DF | reason |
|---|---|---:|---:|---:|---:|---|
| phrase | 단순한 ~을 넘어 | 1 | 1 | 0.555 | 0.21% | dropped-low-lift |
| phrase | 단순한 ~이 아닌 | 4 | 1 | 2.219 | 0.21% | dropped-low-lift |
| phrase | 무한한 가능성 | 1 | 1 | 0.555 | 0.21% | dropped-low-lift |
| phrase | 시너지 효과 | 0 | 1 | 0 | 0.21% | dropped-low-lift |
| phrase | 인사이트를 | 0 | 1 | 0 | 0.21% | dropped-low-lift |
| strict | 가속화 | 2 | 1 | 1.11 | 0.21% | dropped-low-lift |
| strict | 고도화 | 0 | 4 | 0 | 0.86% | dropped-low-lift |
| strict | 다변화 | 1 | 2 | 0.277 | 0.43% | dropped-low-lift |
| strict | 다수의 | 1 | 4 | 0.139 | 0.86% | dropped-low-lift |
| strict | 본격화 | 0 | 2 | 0 | 0.43% | dropped-low-lift |
| strict | 사례로 | 2 | 2 | 0.555 | 0.43% | dropped-low-lift |
| strict | 살펴보면 | 0 | 1 | 0 | 0.21% | dropped-low-lift |
| strict | 생태계 | 10 | 3 | 1.849 | 0.64% | dropped-low-lift |
| strict | 알려져 | 5 | 1 | 2.774 | 0.21% | dropped-low-lift |
| strict | 알아보자 | 0 | 1 | 0 | 0.21% | dropped-low-lift |
| strict | 양립 | 6 | 1 | 3.329 | 0.21% | dropped-low-lift |
| strict | 추세 | 4 | 3 | 0.74 | 0.64% | dropped-low-lift |
| strict | 패러다임 | 0 | 1 | 0 | 0.21% | dropped-low-lift |
| strict | 핵심 | 19 | 19 | 0.555 | 4.08% | dropped-low-lift |
| strict | 행보 | 0 | 1 | 0 | 0.21% | dropped-low-lift |

## Dropped v1.x entries — no corpus coverage (55)

Zero hits on both sides. These skew press-release/marketing register, which the
current corpus does not cover. Re-test candidates when a marketing-register corpus
lands; archived here for that purpose.

| kind | entry | hot | cold | lift | cold DF | reason |
|---|---|---:|---:|---:|---:|---|
| phrase | ~을(를) 시사한다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | ~의 가능성을 열다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | ~의 길을 열다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | ~의 발판을 마련하다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | ~의 사례로 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | ~의 새 지평 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | ~의 새로운 장 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | ~의 지평을 넓히다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | ~의 토대를 다지다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 가속화되고 있다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 가운데 하나로 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 깊은 영감을 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 깊이 있는 통찰 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 깊이를 더하다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 다채로운 매력 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 떠오르고 있다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 매력적인 요소 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 변모하고 있다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 보다 한층 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 본격화되고 있다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 부상하고 있다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 새로운 국면 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 새로운 영감 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 시너지를 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 시사하는 바 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 알려져 있다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 영감을 받다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 영감을 주다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 의미를 지닌다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 주목받고 있다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 진화하고 있다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 차원을 넘어 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 큰 영향을 미치다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 통찰을 얻다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 통찰을 제공 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 패러다임의 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 풍성하게 하다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 풍성한 경험 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 한 단계 도약 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 한 차원 높은 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| phrase | 화두로 떠오르다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| strict | 들여다보면 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| strict | 모색하다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| strict | 부각되다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| strict | 부각하다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| strict | 살펴보다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| strict | 알아보다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| strict | 일컫다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| strict | 일컬어진다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| strict | 자리잡다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| strict | 정교화 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| strict | 짚어보다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| strict | 평가받다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| strict | 풀어내다 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |
| strict | 풀어내며 | 0 | 0 | 0 | 0.00% | dropped-no-coverage |

## Guardrails compliance

- No thresholds changed (density_threshold 3.0, min_hot_matches ko=2 untouched) — B4 calibration gate not triggered.
- Raw corpus text is not committed; this report carries aggregate counts only.
- `expected-ranges.json` refresh (if sub-metric drift appears) is justified by this
  documented, externally-grounded lexicon change — hot/cold fixture labels unchanged.
- Detection-evasion framing not used; this work improves editing-hotspot detection.
