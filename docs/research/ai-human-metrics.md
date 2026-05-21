# AI 글과 사람 글 차이의 지표화 — patina 벤치마크 조사 노트

작성일: 2026-05-20  
상태: 조사/설계 노트, 부분 구현 — deterministic benchmark와 opt-in live quality scaffold 반영

## 1. 질문

patina의 벤치마크에서 측정하려는 것은 단순히 “이 글의 출처가 AI인가?”가 아니다. 더 정확한 질문은 다음이다.

> AI가 쓴 것처럼 읽히는 표면적·문체적 신호를 얼마나 줄였고, 그 과정에서 의미를 얼마나 보존했는가?

따라서 patina의 지표는 법적·징계용 provenance detector가 아니라, **AI-like writing signal을 줄이는 편집 품질 지표**로 정의해야 한다.

## 2. 현재 레포의 기준선

현재 main 기준 벤치마크는 결정론적 suspect-zone 층이 구현돼 있고, live rewrite 품질 평가는 follow-up으로 분리한다.

| 층 | 파일 | 현재 측정값 | 성격 |
|---|---|---|---|
| 결정론적 benchmark | `tests/quality/benchmark.mjs` | accuracy, precision, recall, F1, TP/FP/FN/TN | LLM 호출 없음. stylometry/lexicon hot 판정 회귀 테스트 |
| opt-in live quality scaffold | `tests/quality/live-quality.mjs` | before/after AI-likeness, deterministic meaning proxy, safe_gain, PASS/WARN/FAIL | 기본 실행은 모델 호출 없이 skip. `OPENCODE_AVAILABLE=1`일 때 rewrite 품질과 의미 보존 proxy 점검 |
| scoring spec | `core/scoring.md` | AI-likeness, fidelity, combined score, MPS | 점수 정의의 기준 문서 |
| stylometry spec | `core/stylometry.md` | burstiness CV, MATTR, lexicon density | deterministic signal 정의 |

현재 deterministic hot 판정은 다음 OR 규칙이다.

```text
paragraph is SUSPECT iff
  burstiness_band == "low"
  OR MATTR_band == "low"
  OR lexicon_density > threshold
```

`burstiness_band`는 단락 문장이 3개 이상일 때만 부여한다. 2문장 이하 CV는
진단값으로만 남기고, 그 값만으로는 hot 판정을 만들지 않는다.

현재 공개 benchmark 스냅샷은 ko/en/zh/ja fixture 38개 기준 전체 accuracy 1.0이다. 다만 이 corpus는 작고 설계된 synthetic/curated fixture이므로, 일반화 성능 증거로 과신하면 안 된다.

### 2.1 단기 benchmark 한계와 rebaseline 계획 (#155/#162)

현재 체크인된 deterministic report는 회귀 테스트로는 유용하지만, 공개 성능 주장으로 쓰기에는 아직 좁다.

- 표본 수: ko/en/zh/ja suspect-zone fixture 38개. 언어·장르·출처별 신뢰구간을 낼 만큼 크지 않다.
- 모델 시대성: 2025+ GPT/Claude/Gemini/Llama/Qwen 계열 생성문 rebaseline은 아직 별도 follow-up이다.
- 통계 보고: `docs/benchmarks/latest.md`는 fixture 수, lang/class sample size, Wilson 95% CI와 `signal_score` 기반 ROC-AUC / PR-AUC / best-F1 threshold 진단을 공개한다. bootstrap interval은 아직 없다.
- 범위: 현재 수치는 stylometry/lexicon hot 판정 회귀이며, rewrite 품질·MPS·fidelity의 live 품질 점수가 아니다.

따라서 README/benchmark 문구는 “현재 fixture에서 회귀가 통과했다”로 해석해야 하며, “새 모델·새 장르에서도 100% 탐지한다”는 의미가 아니다. 다음 rebaseline에서는 최소한 언어 × class × register별 sample size를 고정하고, confidence interval과 threshold sweep을 함께 게시한다.

현재 2025+ 재측정 프로토콜은 [2025+ Re-baseline Plan](2025-rebaseline-plan.md)에 둔다. 외부 detector 비교는 `scripts/detector-comparison.mjs`의 수동 입력 경로를 사용해 scraping/API 호출 없이 기록한다.

## 3. 문헌/실무에서 반복되는 지표 축

### 3.1 문장 리듬: burstiness / sentence-length variation

AI 글은 같은 길이의 문장을 안정적으로 반복하는 경향이 있다. patina는 이미 문장 토큰 수의 변동계수(CV)를 사용한다.

```text
CV = stddev(sentence_token_counts) / mean(sentence_token_counts)
```

- 장점: 빠르고 설명 가능하며 ko/en은 whitespace token, zh/ja는 character-token fallback으로 구현 가능하다.
- 약점: 백과사전식 register, 보도자료, 법률/학술 문장도 균질해질 수 있다.
- patina 판단: **유지하되 단독 판정 근거로 쓰지 않는다.**

### 3.2 어휘 다양성: TTR / MATTR / MTLD

MATTR는 길이에 민감한 TTR 문제를 완화하기 위해 moving window를 쓰는 lexical diversity 지표다. patina는 이미 window=50 MATTR를 쓴다.

- 근거: Covington & McFall의 MATTR 논문은 단순 TTR의 길이 의존 문제를 지적하고 moving-average 방식을 제안한다.
- patina 관찰: 영어에서는 보조 신호, 한국어에서는 어절 토큰화 때문에 MATTR가 과대평가되어 약한 신호다.
- patina 판단: **현행 유지. 한국어에서는 주요 신호로 보지 않는다.**

### 3.3 AI-favored lexicon density

AI 글은 의미를 구체화하기보다 추상 명명, 포장어, 의례적 도입/결론 phrase를 반복한다. patina는 `lexicon/ai-en.md`, `lexicon/ai-ko.md`를 통해 lexicon density를 계산한다.

```text
density = matched_ai_lexicon_entries / token_count * 1000
```

- 장점: 해석 가능하고, 패턴팩이 놓치는 어휘적 신호를 잡는다.
- 약점: 도메인별 정상 전문어와 AI 포장어를 혼동할 수 있다.
- patina 판단: **언어/도메인별 calibration이 필요하다.** 특히 한국어 lexicon은 paired corpus mining 방식이 효과적이었다.

### 3.4 패턴 severity score

patina의 가장 중요한 차별점은 “AI detection”보다 “AI writing pattern editing”에 있다. 따라서 다음 패턴들은 detector feature이면서 동시에 rewrite target이다.

- 과잉 연결어, 도입/결론 template
- 추상명사/명사화 연쇄
- 균일한 bullet/heading scaffold
- generic positive conclusion
- 출처 없는 권위 주장
- viral-hook score-only rhetoric

patina 판단: **패턴 점수는 계속 중심축이어야 한다.** 통계 지표는 패턴 스캔의 보조 신호로 둔다.

### 3.5 언어모델 확률 지표

대표 연구:

| 접근 | 주요 아이디어 | patina 적용성 |
|---|---|---|
| [GLTR](https://arxiv.org/abs/1906.04043) | token probability, rank, entropy로 “너무 예측 가능한 선택”을 시각화 | 설명 가능. 단, local LM 또는 API logprob 필요 |
| [DetectGPT](https://arxiv.org/abs/2301.11305) | 생성 텍스트가 log-probability curvature의 특정 영역에 놓인다는 가설 | 강력하지만 perturbation/LM logprob 비용 큼 |
| [Binoculars](https://arxiv.org/abs/2401.12070) | 두 LM의 perplexity/cross-perplexity contrast | 성능 보고는 좋지만 기본 CLI에 넣기엔 무거움 |
| [Ghostbuster](https://arxiv.org/abs/2305.15047) | 약한 LM feature 조합 + classifier | benchmark 연구에는 유용, patina 기본 철학과는 다소 거리 있음 |

patina 판단: **기본 benchmark에는 넣지 말고 optional research track으로 둔다.** 이 레포는 의존성 추가를 보수적으로 해야 하고, 현재 장점은 “설명 가능한 lightweight signal”이다.

### 3.6 Function-word / punctuation / syntax distribution

전통 stylometry는 내용어보다 기능어 분포를 자주 사용한다. 기능어는 주제보다 습관적 문체에 가깝기 때문이다.

후보 지표:

- 영어: `the/of/and/to/in/that/is` 등 function-word frequency vector
- 한국어: 조사/어미 proxy (`은/는`, `이/가`, `을/를`, `에서`, `으로`, `하다/되다` 계열)
- punctuation rhythm: comma/semicolon/dash/parenthesis density
- sentence opener diversity
- POS-like rough proxy: 명사형 종결, 수동 표현, nominalization suffix

patina 판단: **다음 deterministic feature 후보 1순위.** 외부 모델 없이 구현 가능하고, pattern/lexicon과 다른 축이다.

## 4. 탐지 연구에서 얻을 주의사항

### 4.1 detector는 일반적으로 OOD에 약하다

[M4](https://arxiv.org/abs/2305.14902)는 multi-generator, multi-domain, multilingual 맥락에서 detector의 generalization이 어렵다고 보고한다. [RAID](https://arxiv.org/abs/2405.07940)는 sampling strategy, adversarial attack, unseen model 변화에 기존 detector들이 쉽게 속는다고 보고한다.

patina 벤치마크도 같은 함정이 있다. synthetic fixture에서 100%가 나와도 다음 상황에서는 깨질 수 있다.

- unseen LLM: GPT/Claude/Gemini/Llama 계열 차이
- unseen domain: 학술, 법률, 마케팅, 개인 에세이
- unseen decoding: temperature, top-p, repetition penalty
- edited AI: humanizer, paraphrase, 번역 후 재작성
- non-native human prose

### 4.2 단일 “AI 확률”로 말하면 안 된다

OpenAI도 기존 AI classifier를 낮은 정확도 때문에 중단했고, 짧은 텍스트·비영어·OOD·편집된 AI 글에서 취약하다고 명시했다. 공식 문서의 주요 메시지는 “주요 의사결정 도구로 쓰지 말라”는 것이다.

patina도 `AI-generated probability`가 아니라 다음처럼 표현해야 한다.

- 좋음: `AI-likeness`, `AI-like writing signals`, `suspect zones`
- 피해야 함: `이 글은 AI가 쓴 글임`, `AI 확률 87%`, `작성자 판정`

### 4.3 watermark/provenance는 별도 문제다

[Kirchenbauer et al.](https://proceedings.mlr.press/v202/kirchenbauer23a.html)과 [SynthID-Text](https://www.nature.com/articles/s41586-024-08025-4)는 생성 시점에 watermark를 삽입하는 방식이다. 임의의 외부 텍스트를 보고 “AI스러움”을 측정하는 patina와 목적이 다르다.

- watermark: 특정 생성 시스템이 사전에 심은 신호 검출
- patina: 결과 텍스트의 문체적 AI 신호 축소

따라서 watermark는 참고 연구로만 두고, patina benchmark의 주요 지표로 넣지 않는다.

## 5. patina에 맞는 지표 설계안

### 5.1 Feature vector를 먼저 만들고, binary 판정은 그 다음에 둔다

현재 benchmark는 `hot/cold` 판정 중심이다. 연구/튜닝을 위해서는 fixture별 feature vector를 더 풍부하게 남겨야 한다.

```json
{
  "fixture_id": "ko-ai-01",
  "label": "ai",
  "features": {
    "burstiness_cv": 0.059,
    "mattr": 0.91,
    "lexicon_density": 3.4,
    "pattern_hits": 5,
    "pattern_severity_sum": 9,
    "function_word_divergence": 0.12,
    "punctuation_uniformity": 0.33
  },
  "scores": {
    "deterministic_ai_likeness": 72.4,
    "hot": true
  }
}
```

### 5.2 Deterministic AI-likeness score 후보

기본 방향은 “설명 가능한 feature들의 weighted score”다.

```text
deterministic_ai_likeness =
  w1 * burstiness_suspicion
+ w2 * mattr_suspicion
+ w3 * lexicon_suspicion
+ w4 * pattern_suspicion
+ w5 * function_word_suspicion
+ w6 * punctuation_suspicion
```

권장 초기 가중치:

| Feature | 초기 weight | 이유 |
|---|---:|---|
| pattern severity | 0.35 | patina의 주요 목적과 직접 연결 |
| lexicon density | 0.20 | 설명 가능하고 calibration 경험 있음 |
| burstiness CV | 0.20 | 현재 ko/en/zh/ja suspect-zone fixture에서 유효한 주요 deterministic 신호 |
| function-word divergence | 0.15 | 다음 확장 후보. 주제 독립성이 높음 |
| punctuation/opening rhythm | 0.05 | 가벼운 보조 신호 |
| MATTR | 0.05 | 한국어에서 약하므로 낮게 시작 |

단, 이 score는 처음부터 사용자 노출용으로 쓰지 말고 benchmark 내부 연구값으로 둔다.

### 5.3 Humanizer 전용 품질 지표

patina의 최종 성공은 “탐지”가 아니라 “안전한 인간화”다. 따라서 before/after 지표가 필요하다.

#### Humanization Gain

```text
humanization_gain = before_ai_likeness - after_ai_likeness
```

#### Meaning Safety

```text
meaning_safety = min(MPS, fidelity)
```

#### Safe Humanization Gain

```text
safe_gain = max(0, humanization_gain) * (meaning_safety / 100)
```

해석:

| 상황 | 해석 |
|---|---|
| AI score는 많이 낮아졌지만 MPS가 낮음 | 의미를 망가뜨린 가짜 개선 |
| MPS는 높지만 AI score가 그대로임 | 안전하지만 인간화 실패 |
| AI score 하락 + MPS/fidelity 유지 | 성공 |

#### Stability

LLM rewrite는 비결정적이므로 같은 fixture를 N회 돌린 분산도 필요하다.

```text
score_stability = stddev(after_ai_likeness over N runs)
```

보고는 평균만 하지 말고 `mean ± stddev`로 한다.

## 6. benchmark 보고서에 추가할 지표

현재 accuracy/F1은 유지하되, 연구용으로 다음을 추가한다.

| 지표 | 이유 | 우선순위 |
|---|---|---:|
| ROC-AUC | threshold와 무관한 ranking 품질 | 높음 |
| PR-AUC | positive class가 희소해질 때 유용 | 높음 |
| threshold sweep | FP/TP tradeoff 확인 | 높음 |
| per-register FP | 학술/법률/백과/마케팅 등 register별 오탐 확인 | 높음 |
| per-language metrics | ko/en/zh/ja 성능 분리 | 높음 |
| per-generator metrics | GPT/Claude/Gemini/Llama 차이 | 중간 |
| adversarial robustness | paraphrase/humanizer/translation 공격 | 중간 |
| calibration curve / ECE | 점수를 확률처럼 말하지 않기 위한 점검 | 낮음-중간 |

## 7. Corpus 확장 설계

최소 확장 단위는 “언어 × 출처 × register × 생성기”로 나눈다.

### 7.1 Human corpus

| 언어 | 후보 | 목적 |
|---|---|---|
| ko | NamuWiki, 블로그/에세이, 뉴스, 공공문서 | 한국어 register별 FP 측정 |
| en | HC3 human, Wikipedia, news, essays | 기존 calibration 연속성 |
| zh/ja | Wikipedia/뉴스/블로그 계열 | zh/ja benchmark 확장 전 토큰화 결정 필요 |

### 7.2 AI corpus

| 축 | 후보 |
|---|---|
| 모델 | GPT, Claude, Gemini, Llama/Qwen 계열 |
| prompt | neutral, academic, marketing, casual, “humanize this” |
| decoding | default, high temperature, low temperature |
| 후처리 | paraphrase, translation roundtrip, light human edit |

### 7.3 Fixture metadata 권장

```yaml
fixture_id: ko-ai-claude-academic-001
language: ko
class: ai
source_type: generated
model_family: claude
register: academic
prompt_style: neutral
postprocess: none
expected_hot: true
expected_features:
  - low_burstiness
  - ai_lexicon
  - nominalization
notes: |
  왜 이 fixture가 필요한지, 어떤 신호가 발화해야 하는지 기록한다.
```

## 8. 구현 우선순위

### Phase 1 — 보고 강화, 의존성 없음

- `tests/quality/results.json`에 feature vector를 더 상세히 저장
- 더 큰 2025+ corpus에서 threshold sweep과 ROC-AUC/PR-AUC 재계산
- per-register/per-language/per-class 요약 추가
- `tests/quality/README.md`에 “AI-likeness이지 provenance가 아님” 명시

### Phase 2 — corpus 확장

- synthetic/curated fixture 38개에서 real-world sampled fixture로 확장
- human false positive register를 먼저 늘린다
- 목표: 언어별 최소 100 human + 100 AI paragraph

### Phase 3 — 새 deterministic feature

- function-word divergence
- punctuation rhythm
- sentence opener diversity
- 한국어 수동/명사화 proxy

이 단계도 외부 의존성 없이 구현 가능해야 한다.

### Phase 4 — optional LM probability research

- GLTR-style logprob/rank/entropy 실험
- Binoculars/DetectGPT류는 별도 research script로만 검토
- 기본 CLI/benchmark에는 넣지 않는다

## 9. 성공 기준 제안

현재 README의 공개 수치와 충돌하지 않게 다음 기준을 둔다.

| 기준 | 제안 threshold |
|---|---:|
| AI catch rate | ≥ 75% |
| max human FP | ≤ 25% |
| register-specific FP | 각 register ≤ 30%, 경계 register는 별도 표기 |
| rewrite after AI-likeness | target ≤ 30 |
| MPS floor | ≥ 70 |
| fidelity floor | ≥ 70 |
| safe_gain | 양수이고 meaning_safety ≥ 70 |

주의: 이 기준은 “작성자 판정”이 아니라 patina 내부 품질 회귀 기준이다.

## 10. 결론

patina가 따라야 할 방향은 범용 AI detector가 아니다. 더 강한 방향은 다음이다.

1. **설명 가능한 다중 신호**로 AI-like writing pattern을 측정한다.
2. **human false positive를 register별로 공개**한다.
3. **rewrite 전후의 gain과 meaning safety를 함께 본다.**
4. **단일 AI 확률을 주장하지 않는다.**
5. 무거운 LM-probability detector는 optional research track으로 격리한다.

즉, patina benchmark의 주요 지표는 다음 세 문장으로 요약할 수 있다.

```text
얼마나 AI스럽게 읽히는가?
얼마나 사람 글의 변동성과 구체성을 회복했는가?
그 과정에서 의미를 얼마나 안전하게 보존했는가?
```

## 참고 자료

- GLTR: Statistical Detection and Visualization of Generated Text — https://arxiv.org/abs/1906.04043
- DetectGPT: Zero-Shot Machine-Generated Text Detection using Probability Curvature — https://arxiv.org/abs/2301.11305
- Ghostbuster: Detecting Text Ghostwritten by Large Language Models — https://arxiv.org/abs/2305.15047
- M4: Multi-generator, Multi-domain, and Multi-lingual Black-Box Machine-Generated Text Detection — https://arxiv.org/abs/2305.14902
- RAID: A Shared Benchmark for Robust Evaluation of Machine-Generated Text Detectors — https://arxiv.org/abs/2405.07940
- Spotting LLMs With Binoculars — https://arxiv.org/abs/2401.12070
- Can AI-Generated Text be Reliably Detected? — https://arxiv.org/abs/2303.11156
- OpenAI: New AI classifier for indicating AI-written text — https://openai.com/index/new-ai-classifier-for-indicating-ai-written-text/
- A Watermark for Large Language Models — https://proceedings.mlr.press/v202/kirchenbauer23a.html
- SynthID-Text / Scalable watermarking for identifying large language model outputs — https://www.nature.com/articles/s41586-024-08025-4
- Covington & McFall, MATTR — https://www.tandfonline.com/doi/abs/10.1080/09296171003643098
