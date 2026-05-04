---
name: Stylometric Suspect-Zone Detection
version: 2.1.0
description: Deterministic statistical preprocessing that flags suspect paragraphs and sentence groups before pattern scanning, used by SKILL.md Step 4.6 (burstiness + MATTR) and Step 4.7 (AI-lexicon overlap)
---

# Stylometric Suspect-Zone Detection

결정론적 통계 분석으로 패턴 카탈로그가 놓치는 "이름 없는 AI다움"을 표시하는 전처리 단계.
패턴 스캔 이전에 단락 단위 burstiness와 어휘 다양성(MATTR)을 계산하고, 의심 단락 내부에서
문장 단위로 zoom-in 한다. 결과는 LLM에게 내부 작업 메모리로 전달되며 사용자 출력에는 노출하지 않는다.

---

## 1. Overview

`core/scoring.md`가 패턴 감지 결과를 0-100 점수로 환산하는 채점 알고리즘이라면,
이 문서는 패턴 스캔 *이전에* 동작하는 통계 전처리 알고리즘을 정의한다.

목적:
- 28개 패턴 카탈로그가 직접 명명하지 못하는 분포적 단서(균질한 문장 길이, 빈약한
  어휘 다양성)를 결정론적 수치로 잡아낸다
- 4.5단계 의미 앵커(Semantic Anchor)와 같은 "내부 작업 메모리" 패턴을 따라,
  hot 단락/문장 정보를 5a·5b 입력에 주입한다
- 외부 의존성(형태소 분석기, 외부 detector API) 없이 whitespace 토큰화만으로 동작한다

이 알고리즘은 5a 구조 분석 단계와 5b 문장/어휘 단계에 자연스럽게 결합되도록 설계되었다.
- 5a는 단락 수준 hot 표시를 우선 검토 대상으로 사용한다
- 5b는 문장 수준 hot 그룹을 우선 재작성 대상으로 사용한다

### 언어 범위 (v1)

| 언어 | v1 지원 | 비고 |
|------|---------|------|
| ko | yes | 어절 단위 토큰화 |
| en | yes | 단어 단위 토큰화 |
| zh | no (v2+) | character-based 토큰화 별도 작업 필요 |
| ja | no (v2+) | 형태소 분석기 의존성 분리 필요 |

`stylometry.languages` 설정에 포함되지 않은 언어는 4.6단계를 skip 한다.

---

## 2. Tokenization Policy

외부 의존성을 배제하기 위해 형태소 분석기 없이 whitespace + edge-punctuation strip 만으로
토큰화한다. raw token만으로도 burstiness와 MATTR 신호는 충분히 안정적이다.

### 절차

```
tokens = []
FOR each whitespace-separated chunk IN sentence:
    stripped = chunk with leading/trailing `\W` characters removed
    IF stripped is non-empty:
        tokens.append(stripped)
```

- `\W` 는 정규식의 비단어 문자 클래스 (Unicode aware: 한글·영문 단어 문자는 보존)
- 내부 punctuation(예: `don't`, `좋은-도구`)은 token 일부로 유지한다
- 빈 문자열은 token 으로 인정하지 않는다

### 단위

| 언어 | 토큰 단위 | 예시 입력 | 토큰 |
|------|-----------|-----------|------|
| ko | 어절 (whitespace 기준) | `이 도구는 자동완성처럼 동작한다` | `[이, 도구는, 자동완성처럼, 동작한다]` |
| en | 단어 (whitespace 기준) | `The tool acts like autocomplete.` | `[The, tool, acts, like, autocomplete]` |

> **주의:** 한국어는 어절 기준이므로 morpheme-level 분석과 다르다. `도구는`과 `도구가`는
> 서로 다른 토큰으로 취급된다. v1은 이 단순화로 진행하며, 형태소 분석기 도입은 v2 이후로 보류한다.

---

## 3. Sentence Splitting

문장 분할은 단순 정규식만 사용한다. 약어·소수점 등 false split 가능성은 v1에서 감수한다.

### 규칙

```
split text on regex: [.!?。…]+\s+ OR \n+
trim whitespace
drop empty fragments
```

종결부호 후보:
- `.` (마침표)
- `!` (느낌표)
- `?` (물음표)
- `。` (전각 마침표 — 향후 ja/zh 확장 대비)
- `…` (말줄임표)
- 줄바꿈 `\n`

### 단락 분할

- 빈 줄(`\n\s*\n`) 기준으로 단락 분리
- 단락 내부 줄바꿈은 같은 단락의 문장 경계로 취급

---

## 4. Burstiness Metric

문장 길이의 변동성을 측정한다. AI 텍스트는 문장 길이가 균질해지는 경향이 있다.

### 공식

```
sentence_token_counts = [len(tokens) for sentence in paragraph.sentences]
mean = sum(sentence_token_counts) / len(sentence_token_counts)
stddev = sqrt(sum((x - mean)^2) / len(sentence_token_counts))   # population stddev
burstiness_CV = stddev / mean
```

- `CV` = Coefficient of Variation (변동계수)
- mean 이 0 이면 정의되지 않음 → skip 처리
- population stddev 사용 (표본 보정 없음, 단순화)

### 밴드

| 밴드 | 임계값 | 해석 |
|------|--------|------|
| low | CV < 0.30 | 문장 길이가 균질함 — AI 의심 |
| mid | 0.30 ≤ CV ≤ 0.50 | 자연스러운 변동 |
| high | CV > 0.50 | 사람다운 큰 변동 |

임계값은 `.patina.default.yaml`의 `stylometry.burstiness.bands`에서 조정 가능하다.

> **v3.5.1 calibration:** 초기 임계값은 `0.25`였다. 외부 300 단락
> (HC3 ChatGPT 100 + HC3 human 100 + Wikipedia 100) 측정 후 `0.30`으로 상향 조정.
> 0.25에서는 AI catch rate 가 57%에 그쳐 v1 목표(70%) 미달이었고,
> 0.30에서 66%까지 상승. 0.35 이상은 Wikipedia false positive 가 34%+ 로
> 급증해 채택하지 않음. 자세한 sweep 결과는 §13 참조.

---

## 5. TTR via MATTR

Type-Token Ratio (TTR)는 어휘 다양성 지표다. 텍스트 길이에 민감하므로 단순 TTR 대신
MATTR (Moving Average TTR)을 사용해 길이 의존성을 줄인다.

### 공식

```
window = 50  # tokens
lower_tokens = [token.lower() for token in paragraph_tokens]   # no stemming, no lemmatization
IF len(lower_tokens) < window:
    MATTR = len(set(lower_tokens)) / len(lower_tokens)         # fall back to simple TTR
ELSE:
    ratios = []
    FOR i in 0 .. len(lower_tokens) - window:
        slice = lower_tokens[i : i + window]
        ratios.append(len(set(slice)) / window)
    MATTR = sum(ratios) / len(ratios)
```

- token normalization: lowercase 만 적용 (stemming/lemmatization 없음)
- 한국어 어절 token은 lowercase가 거의 영향 없음 (영문 외래어만 영향)
- window=50은 문헌 권장값 (Covington & McFall 2010)

### 밴드

| 밴드 | 임계값 | 해석 |
|------|--------|------|
| low | MATTR < 0.55 | 어휘 반복 많음 — AI 의심 |
| mid | 0.55 ≤ MATTR ≤ 0.70 | 자연스러운 다양성 |
| high | MATTR > 0.70 | 풍부한 어휘 |

임계값은 `.patina.default.yaml`의 `stylometry.ttr.bands`에서 조정 가능하다.

---

## 6. Hot Decision Rule

단락 수준 SUSPECT 판정은 단순한 OR 규칙으로 결정한다.

```
paragraph is SUSPECT iff
  burstiness_band == "low"  OR  MATTR_band == "low"
```

### 근거

- 두 신호 중 하나만 약해도 사람 글에서는 드물게 동시 발생한다
- AND 조건은 recall 이 너무 낮아 v1 acceptance criteria(AI 시드 7/10)를 만족하기 어렵다
- false positive 는 `FalsePositiveControl` 평가(자연 시드 ≤2/10)로 견제한다

### 임계값 재조정

v1 결과에서 false positive 가 한도(자연 시드 2/10)를 넘기면, `.patina.default.yaml`의
`stylometry.burstiness.bands.low` 또는 `stylometry.ttr.bands.low` 를 보수적으로 낮춰
재평가한다 (예: 0.30 → 0.27).

---

## 7. Sentence Zoom Rule

hot 단락 내부에서 문장 수준 sub-flag 을 생성한다. 단락 전체를 재작성 대상으로
지정하지 않고, 가장 의심스러운 인접 문장 그룹만 가리키는 것이 목적이다.

### 규칙

```
similarity_threshold = 0.20   # ±20% token count

FOR each pair of adjacent sentences (S_i, S_{i+1}) in hot paragraph:
    smaller = min(len(S_i.tokens), len(S_{i+1}.tokens))
    larger  = max(len(S_i.tokens), len(S_{i+1}.tokens))
    IF smaller == 0:
        continue
    IF (larger - smaller) / smaller < similarity_threshold:
        mark (S_i, S_{i+1}) as adjacent-similar pair

merge overlapping pairs into contiguous groups
emit groups of length ≥ 2 as sub-flags
```

- 기준은 토큰 수 차이 < 20% (i.e., 길이 비가 대략 1.0 ~ 1.20 범위)
- 단일 문장은 sub-flag 으로 emit 하지 않는다 (인접 유사 페어 필요)
- 임계값은 `stylometry.sentence_zoom.similarity_threshold` 에서 조정 가능

### 출력

각 sub-flag 은 `P{n}.S{m..k}` 범위로 표기한다. 예: `P2.S1-S3`.

---

## 8. Skip Conditions

오버헤드 회피를 위해 짧은 텍스트는 통째로 skip 한다.

| 조건 | 동작 |
|------|------|
| 단락 수 ≤ 2 | 4.6단계 전체 skip — meta block 생략 |
| 전체 문장 수 ≤ 2 | 4.6단계 전체 skip — meta block 생략 |
| 단락 내 문장 수 < 2 | 해당 단락은 burstiness 계산 불가 → MATTR 만 평가 |
| 단락 내 토큰 수 = 0 | 해당 단락 skip |
| 언어가 `stylometry.languages` 에 없음 | 4.6단계 전체 skip |

임계값은 4.5단계 의미 앵커 추출의 skip 조건과 동일하다.

> **참고:** 4.6단계가 skip 되면 5a·5b 입력에 `<suspect-zones>` meta block이 포함되지 않는다.
> 이 경우 파이프라인은 정상 진행한다 (suspect-zone 정보 없이).

---

## 9. LLM Delivery Format

분석 결과는 5a 입력 직전에 텍스트 상단에 삽입되는 meta block 과, 본문 내 단락 prefix
두 가지 형태로 LLM 에 전달된다.

### Meta Block

```
<suspect-zones lang="{ko|en}">
- P{n}: burstiness={float} ({low|mid|high}), MATTR={float} ({low|mid|high}) — {short reason}
- P{n}.S{m}: {short reason}
</suspect-zones>
```

규칙:
- hot 단락만 entry 로 emit (mid/high 단락은 생략)
- burstiness 와 MATTR 은 소수 둘째 자리까지 표기
- short reason 은 한국어 한 줄 (예: `문장 길이 균질`, `어휘 반복 다수`)
- 문장 sub-flag 은 별도 entry 로 추가
- meta block 전체는 사용자 출력에 노출하지 않는다 (anchor 와 동일 정책)

### Body Prefix

hot 단락 본문 첫머리에 토큰 prefix `«P{n} SUSPECT»` 를 삽입한다.

```
«P2 SUSPECT» 이 도구는 단순한 자동완성을 넘어선다. ...
```

- 이 prefix 는 5a/5b 처리 시점에 LLM 이 즉시 인지하도록 신호를 reinforce 한다
- 5c 자기검수 단계에서 prefix 와 meta block 모두 제거된 최종 출력을 생성한다
- 사용자 대면 출력에는 prefix 가 절대 남지 않아야 한다

### 5c 회귀 체크 (옵션)

5c 자기검수 단계에서 hot zone 들이 모두 처리되었는지 확인할 수 있다.
- 모든 hot 단락이 어떤 형태로든 재작성되었는지 (단락 비교)
- 처리되지 않은 hot zone 이 있으면 경고 (강제 재처리는 v1 범위 밖)

---

## 10. Worked Example

### 한국어 예시

입력 (단락 1개):

```
이 도구는 단순한 자동완성을 넘어선다. 이 도구는 사용자의 의도를 이해한다.
이 도구는 효율적인 협업을 가능하게 한다. 이 도구는 혁신적인 생산성을 제공한다.
이 도구는 다양한 언어를 지원한다.
```

### Step-by-step

**Tokenize (어절 단위)**

| 문장 | 토큰 수 |
|------|---------|
| S1 | 5 |
| S2 | 5 |
| S3 | 5 |
| S4 | 5 |
| S5 | 5 |

**Burstiness**

```
mean = 5
stddev = 0
CV = 0 / 5 = 0.00
band = low (< 0.30)
```

**MATTR**

전체 토큰 수 = 25 < 50 → simple TTR fallback.

```
lower_tokens = [이, 도구는, 단순한, 자동완성을, 넘어선다, 이, 도구는, 사용자의,
                 의도를, 이해한다, 이, 도구는, 효율적인, 협업을, 가능하게, 한다,
                 이, 도구는, 혁신적인, 생산성을, 제공한다, 이, 도구는, 다양한,
                 언어를, 지원한다]
                 # 26 tokens
unique = {이, 도구는, 단순한, 자동완성을, 넘어선다, 사용자의, 의도를, 이해한다,
          효율적인, 협업을, 가능하게, 한다, 혁신적인, 생산성을, 제공한다,
          다양한, 언어를, 지원한다}
        # 18 unique
TTR = 18 / 26 ≈ 0.69
band = mid (0.55 ≤ 0.69 ≤ 0.70)
```

**Hot Decision**

burstiness=low → **SUSPECT** (OR 조건 충족).

**Sentence Zoom**

모든 인접 문장이 동일한 토큰 수(5) → 차이 0% < 20% → S1-S5 전체가 한 그룹.

**Meta Block 출력**

```
<suspect-zones lang="ko">
- P1: burstiness=0.00 (low), MATTR=0.69 (mid) — 문장 길이 균질
- P1.S1-S5: 인접 문장 토큰 수 동일
</suspect-zones>
```

**Body Prefix**

```
«P1 SUSPECT» 이 도구는 단순한 자동완성을 넘어선다. 이 도구는 사용자의 의도를 이해한다.
이 도구는 효율적인 협업을 가능하게 한다. 이 도구는 혁신적인 생산성을 제공한다.
이 도구는 다양한 언어를 지원한다.
```

### 영어 예시

입력 (단락 1개):

```
The tool is innovative. The tool is efficient. The tool is reliable.
The tool is scalable. The tool is essential.
```

**Tokenize (단어 단위)**

각 문장 4 토큰. 전체 토큰 수 = 20.

**Burstiness**

```
mean = 4, stddev = 0, CV = 0.00 → low
```

**MATTR**

전체 토큰 수 20 < 50 → simple TTR.

```
lower_tokens = [the, tool, is, innovative, the, tool, is, efficient, the, tool,
                is, reliable, the, tool, is, scalable, the, tool, is, essential]
unique = {the, tool, is, innovative, efficient, reliable, scalable, essential}
        # 8 unique
TTR = 8 / 20 = 0.40
band = low (< 0.55)
```

**Hot Decision**

burstiness=low AND MATTR=low → **SUSPECT** (둘 다 충족).

**Meta Block 출력**

```
<suspect-zones lang="en">
- P1: burstiness=0.00 (low), MATTR=0.40 (low) — uniform sentence length, low lexical diversity
- P1.S1-S5: identical token counts
</suspect-zones>
```

**Body Prefix**

```
«P1 SUSPECT» The tool is innovative. The tool is efficient. The tool is reliable.
The tool is scalable. The tool is essential.
```

---

## 11. Roadmap (v2+)

v1 범위에서 의도적으로 제외한 항목. v1 시드 평가 결과를 바탕으로 우선순위를 재조정한다.

| 항목 | 설명 | 도입 후보 시점 |
|------|------|----------------|
| ~~n-gram redundancy~~ | ~~bi/trigram 반복도~~ — **dropped, §15 negative finding** | — |
| ~~AI-lexicon overlap~~ | ~~28-패턴 외 AI 특유 어구 사전 매칭~~ — **shipped v3.7, §16** | v3.7 |
| Perplexity proxy | small LM 또는 cloze prompt 기반 token-level surprise | v4 후보 |
| Function-word distribution | 기능어 빈도 분포 차이 (Mosteller & Wallace 류) | v4 후보 |
| GPTZero / Originality 연동 | 외부 detector API 결과를 hot 신호로 합산 | v4+ 후보 |
| 형태소 분석 기반 ko 토큰화 | 어절 → 형태소 단위로 정밀화 | v2+ |
| zh character-based 토큰화 | 한자 단위 burstiness/TTR 정의 | v2 |
| ja 형태소 분석 통합 | 일본어 단어 경계 처리 | v2 |
| 사용자 idiolect 학습 | 개인 작성 스타일 학습 후 false positive 억제 | 별도 트랙 |
| 정량 라벨 데이터셋 | 언어별 50+ 라벨 데이터 기반 임계값 튜닝 | v1 결과 후 검토 |

---

## 12. Known Limitations

- **Korean morphology coarseness**: 어절 단위 토큰화는 morpheme-level 분석과 다르다.
  같은 명사의 조사 변형(`도구는`, `도구가`, `도구를`)을 서로 다른 token 으로 취급하므로
  MATTR 이 실제보다 약간 높게 나올 수 있다.
- **Short text noise**: 단락 ≤2 또는 문장 ≤2 인 텍스트는 통계적으로 신뢰할 수 없어 skip
  한다. 이 경우 4.6단계 전체가 비활성화된다.
- **Window=50 fallback**: MATTR window 보다 짧은 단락은 simple TTR 로 fallback 하므로
  길이 의존 편향이 일부 남는다. 단락 비교 시 길이 차가 크면 신중히 해석한다.
- **LLM non-determinism**: 통계 계산 자체는 결정론적이나, 5a/5b 가 hot 정보를 어떻게
  활용할지는 LLM 의 판단에 달려 있다. acceptance criteria 는 hot 표시 정확도까지만 보장한다.
- **No external detector**: v1 은 외부 detector API(GPTZero 등)와 통합하지 않는다.
  외부 신호는 v3 후보 로드맵 항목이다.
- **False split**: 약어(`Mr.`, `e.g.`) 와 소수점(`3.14`) 같은 종결부호 오인식을 v1 에서
  감수한다. 시드 평가에서 false positive 비율이 한도를 넘기면 v1.1 에서 보강한다.
- **Language scope**: v1 은 ko + en 만 지원한다. zh/ja 는 character-based 또는 형태소
  분석기 의존성이 있어 별도 작업으로 분리했다.

---

## 13. Calibration Appendix (v3.5.1)

v3.5.0 자체 시드 평가는 만점이었으나(AI 10/10, 자연 0/10), 외부 데이터에서는 신호가 약했다. 시드 픽스처를 작성한 측과 측정 알고리즘이 같았기 때문이다(자기 일관성). 이 절은 v3.5.1 calibration 의 근거 데이터다.

### 외부 측정 (300 단락)

| Source | n | hot rate (v3.5.0, 0.25) | hot rate (v3.5.1, 0.30) | CV median |
|--------|---|--------------------------|--------------------------|-----------|
| HC3 ChatGPT 답변 (en) | 100 | 57.0% | 66.0% | 0.220 |
| HC3 human 답변 (en) | 100 | 8.0% | 12.0% | 0.511 |
| Wikipedia 도입 단락 (en) | 100 | 19.0% | 23.0% | 0.386 |

### 임계값 sweep 핵심 결과

burstiness × MATTR 35조합을 모두 측정. **AI ≥70% AND max FP ≤20% 동시 만족하는 조합은 0개.** Pareto frontier 상위:

| burst | mattr | AI hot | HC3 FP | Wiki FP | utility |
|-------|-------|--------|--------|---------|---------|
| 0.25 | 0.55 (v3.5.0) | 57% | 8% | 19% | 38 |
| **0.30** | **0.55 (v3.5.1)** | **66%** | **12%** | **23%** | **43** |
| 0.35 | 0.55 | 73% | 22% | 34% | 39 |
| 0.40 | 0.55 | 84% | 35% | 57% | 27 |

v3.5.1 은 utility 최대점. 0.35 이상은 Wikipedia FP 가 급증해 백과사전체 자연 텍스트를 과도하게 hot 으로 표시.

### MATTR 의 약한 변별력 — 정직한 한계

MATTR 임계값을 `0.55 → 0.78` 로 광범위하게 sweep 해도 AI 와 사람의 발화 빈도 차이가 거의 없었다.

| MATTR threshold | AI MATTR-only fires | Human MATTR-only fires |
|-----------------|---------------------|------------------------|
| 0.65 | 2/100 | 3/100 |
| 0.70 | 6/100 | 5/100 |
| 0.75 | 16/100 | 19/100 |

MATTR 0.75 에서는 사람 텍스트가 오히려 더 자주 hot 발화. 자유 산문에서는 어휘 다양성이 AI/사람 변별 신호로 약하다는 의미. v3.5.1 은 **MATTR 임계값을 0.55 로 유지**한다 (실질적으로 거의 발화하지 않는 안전 신호로 보존; 임계값 상향은 false positive 만 늘림). 후속 §15 에서 n-gram 반복도도 같은 한계를 보임 — 단순 redundancy 신호 추가만으로는 Pareto 벽을 못 뚫는다.

### Wikipedia 의 register 문제

Wikipedia 도입 단락은 백과사전체 register 라 자연스럽게 균질한 문장 길이를 가진다(CV median 0.386). v3.5.1 에서 23% false positive 는 v1 acceptance(≤20%) 를 살짝 위반하나 register issue 에서 비롯된 구조적 한계로 본다. 단순 임계값 조정으로는 해소되지 않으며, §15 에서 확인했듯 n-gram redundancy 도 도움이 되지 않는다 — 백과사전체 균질성과 AI 균질성을 분리하려면 perplexity 또는 AI-lexicon 같은 다른 축의 신호가 필요하다.

### 운용상 권고

v3.5.1 은 advisory marker 로 사용하라. 패턴 카탈로그가 명명한 28 개 신호의 **보조 입력**이며, 단독 결정 신호로 쓰기엔 catch rate(66%) 가 부족하다. 단락이 hot 표시되면 LLM 이 우선 검토하고, 표시되지 않더라도 패턴 단계가 정상 작동한다.

### 외부 검증 재현

`.omc/research/eval_external_v2.py` 로 측정, `.omc/research/threshold_sweep.py` 로 sweep 수행. raw 결과는 `.omc/research/external_results_v2.json`. 재실행 시 HuggingFace `Hello-SimpleAI/HC3` + `wikimedia/wikipedia` 20231101.en 다운로드 발생.

---

## 14. Korean External Validation (post-v3.5.1)

v3.5.1 calibration 은 영어 데이터(HC3 + Wikipedia)만 사용했다. 이후 NamuWiki 100 단락 (`heegyu/namuwiki`, CC-BY-NC-SA 2.0 KR) 으로 한국어 자연 텍스트 검증을 수행했다.

### 결과

| Source | n | CV median | MATTR median | hot rate (v3.5.1) |
|--------|---|-----------|--------------|-------------------|
| NamuWiki (ko 자연) | 100 | 0.592 | 0.941 | **11.0%** |
| HC3 human (en 자연) | 100 | 0.511 | 0.792 | 12.0% |
| Wikipedia (en 자연) | 100 | 0.386 | 0.770 | 23.0% |

NamuWiki 한국어 단락의 burstiness CV 중앙값(0.592)은 영어 자연 텍스트보다 더 높고, hot rate 11% 는 v1 자연 대조 한도(≤20%) 를 여유롭게 통과한다. **v3.5.1 임계값이 한국어에서도 그대로 유효함을 확인.**

### MATTR 의 한국어 특이성

MATTR median 0.941 — 영어 자연 텍스트(0.77~0.79) 보다 훨씬 높다. 이유: 어절 단위 토큰화가 `도구는`/`도구가`/`도구를` 같은 조사 변형을 별개 토큰으로 취급해 어휘 다양성이 인위적으로 부풀려진다. §12 Known Limitations 에서 명시한 한계가 데이터로 확인됨. 한국어에서 MATTR 신호는 사실상 발화하지 않는다 (NamuWiki 100 단락 중 0건 hot).

### 한국어 AI 텍스트 측정 (post-v3.7.0)

자유 배포 한국어 AI 코퍼스가 없어 NamuWiki 100 토픽을 시드로 Claude (claude -p, opus) 에 paired 한국어 단락 100건을 자가 생성한 뒤 측정했다 (`.omc/research/ko_ai_robust.py`).

| 지표 | ko/AI (Claude 생성, n=100) | ko/human (NamuWiki, n=100) | gap |
|------|---------------------------|----------------------------|-----|
| CV median | 0.200 | 0.592 | — |
| MATTR median | 0.982 | 0.941 | — |
| lexicon density median | 0.00 | n/a | — |
| **hot rate (v3.5.1: burst+MATTR)** | **82.0%** | 11.0% | **+71pp** |
| **hot rate (v3.7.0: 3-signal OR)** | **83.0%** | 13.0% | **+70pp** |

**해석:**
- 한국어 AI catch rate (82~83%) 가 영어 AI catch rate (76%, HC3) 보다 높다. Claude 가 생성한 한국어 백과사전체 산문이 균질한 문장 길이를 더 강하게 보이는 경향.
- v3.5.1 burstiness 임계값이 한국어에서 그대로 잘 작동 — 별도 calibration 불필요.
- MATTR 은 한국어에서 0/100 발화 (median 0.982). 어절 토큰화 한계로 사실상 죽은 신호.
- lexicon 은 +1pp 보조 (9/100 발화). 영어 (+10pp) 보다 약함 — Korean lexicon (90 entries) 의 효과는 제한적이며, 이후 사용자 corpus 측정으로 재조정 여지 있음.
- ko/human FP (13%) vs ko/AI hot (83%) 의 gap 70pp 는 영어 gap (52pp) 보다도 크다. 한국어에서 stylometric 신호가 강하게 동작.

**한계:**
- AI 측 데이터가 Claude 자가 생성이라 OOM (out-of-our-model) AI 시스템(GPT-4, Gemini, Llama 등) 검증은 별도. v4 에서 멀티모델 paired corpus 로 확장 예정.
- NamuWiki 토픽이 알파벳 가나다순 첫 100건이라 도메인 편향 가능성 (라이트노벨 캐릭터, 가면라이더 시리즈가 다소 많음). 도메인 stratified sample 은 v4 후보.

---

## 15. v3.6 n-gram Repetition — Negative Finding

§13 Pareto 벽을 뚫기 위한 v2 후보였던 n-gram 반복도 신호를 동일 코퍼스(400 단락 = HC3 AI/human + Wikipedia + NamuWiki) 에 추가 측정했다.

### 측정값 분포

| Source | bigram redundancy median | trigram redundancy median |
|--------|--------------------------|---------------------------|
| HC3 ChatGPT | 0.051 | 0.000 |
| HC3 human | **0.071** | 0.012 |
| Wikipedia | 0.046 | 0.000 |
| NamuWiki | 0.000 | 0.000 |

### 핵심 발견

**HC3 human 의 bigram redundancy (0.071) 가 HC3 AI (0.051) 보다 오히려 높다.** Q&A 형식의 사람 답변이 ChatGPT 답변보다 구조적으로 더 반복적이라는 의미. n-gram 반복도는 AI/사람 변별 신호로 쓸모가 없다 — 적어도 단순 redundancy 정의(`1 - unique/total`) 로는 그렇다.

trigram 임계값 sweep 에서도 AI catch 와 human FP 가 거의 같은 비율로 함께 오르내림 (gap 변동 ±2pp). 신호 추가 효과 없음.

### 운용 결정

n-gram 반복도를 ship 하지 않는다. v3.5.1 상태 유지. roadmap 에서 n-gram 항목을 제거하고, 다음 후보로 이동:

- **Perplexity proxy** (token-level surprise) — 구조적 균질성과 다른 축의 신호. AI 텍스트는 token 별 conditional probability 가 일관되게 높음 (LM 이 다음 토큰을 잘 예측). 구현: small LM (예: GPT-2 small) 또는 cloze prompt 기반 추정. v4 후보.
- **AI-lexicon overlap** — 28-패턴이 명명하지 못한 AI 특유 어구 사전("transformative", "cutting-edge", "leveraging" 류) 와의 단순 매칭. 패턴 카탈로그의 통계적 보강. v3.7 후보.
- **Function-word distribution** — AI 와 사람의 of/in/the/는/이/를 등 기능어 빈도 차이. Stylometric authorship attribution 문헌 (Mosteller & Wallace 1964 연속) 의 고전 신호. v4 후보.

### 재현

`.omc/research/v3_6_ngram_probe.py` 로 측정, raw 결과는 `.omc/research/v3_6_results.json`. HuggingFace `Hello-SimpleAI/HC3` + `wikimedia/wikipedia` + `heegyu/namuwiki` 다운로드 발생.

---

## 16. AI-Lexicon Overlap Signal (v3.7)

§13 calibration 과 §15 n-gram 부정 결과 모두 같은 결론을 가리켰다 — 구조적 균질성(burstiness, MATTR, n-gram redundancy)은 백과사전체와 AI를 충분히 분리하지 못한다. 다른 축의 신호가 필요했다. v3.7은 28-패턴 카탈로그가 명시적으로 잡지 못하는 AI 특유 어구를 평면 사전(flat dictionary)으로 추가 매칭해 어휘 축의 신호를 도입한다.

### 알고리즘

```
For paragraph P with tokens T:
  matches = number of lexicon entries that appear in P
            (case-insensitive, whole-word for "Strict matches",
             substring for "Multi-word phrases")
  density = matches / len(T) * 1000   # matches per 1000 tokens

  hot iff density > threshold
```

기본 threshold = `2.0` (1,000 토큰당 2회). `lexicon.density_threshold`로 설정 가능.

### 단락 hot 결정 규칙 (3-signal OR)

```
paragraph is SUSPECT iff
  burstiness_band == "low" OR MATTR_band == "low" OR lexicon_density > threshold
```

§6의 2-signal OR 규칙을 3-signal OR로 확장한다. burstiness/MATTR는 분포적 신호, lexicon은 어휘적 신호 — 다른 축이라 OR 결합 시 둘 다 합산 효과를 낸다.

### 사전 파일

- `lexicon/ai-en.md` — 영어 50개 strict + 58개 phrase = 108 entries
- `lexicon/ai-ko.md` — 한국어 41개 strict + 49개 phrase = 90 entries

탐색은 `Glob lexicon/ai-{lang}.md`로 자동. zh/ja는 v1 미지원 (`lexicon.languages` 기본 `[en, ko]`). 사용자가 `custom/lexicon/ai-{lang}.md` 를 두면 우선 로드.

### 매칭 정책

- **Strict matches** (Markdown `## Strict matches` 섹션): 대소문자 무시 whole-word 매칭. 한국어 어절(예: `자리매김`)은 substring으로 근사 — Korean punctuation/space로 분리되므로 false attach 위험이 낮다
- **Multi-word phrases** (Markdown `## Multi-word phrases` 섹션): 대소문자 무시 substring 매칭. `~` 가 포함된 한국어 phrase(예: `~의 지평을 넓히다`)는 `~` 을 wildcard 로 취급 (`.{0,40}`)
- 한 paragraph 안에서 같은 entry 가 여러 번 나와도 1로 계산 (entry 단위 카운트)

### LLM 전달 형식 확장

기존 `<suspect-zones>` meta block을 lexicon hit 정보로 확장한다.

```
<suspect-zones lang="ko">
- P1: burstiness=0.18 (low) — 문장 길이 균질
- P2: lexicon_density=4.2/1000 — AI-lexicon hits: "혁신적인 접근, 패러다임 전환, 시너지"
- P3: burstiness=0.22 (low), lexicon_density=3.1/1000 — 균질 + AI 어휘 다수
</suspect-zones>
```

규칙:
- lexicon hit이 있는 단락은 매칭된 entry 중 최대 5개를 짧은 인용으로 표기
- burstiness/MATTR hot 과 lexicon hot 이 동시 발화하면 한 줄에 합쳐서 표기
- meta block 전체는 사용자 출력에 노출하지 않는다 (§9 Anchor 정책과 동일)

### Body Prefix

§9의 `«P{n} SUSPECT»` prefix 는 lexicon-only hot 단락에도 동일하게 적용한다. LLM 입력에는 hot의 발화 사유가 무엇이든 동일한 신호로 도착한다.

### v3.7 Calibration (외부 400 단락)

같은 코퍼스(HC3 ChatGPT/human + Wikipedia + NamuWiki)로 `density_threshold` 0.5–5.0 범위 sweep.

| Source | n | v3.5.1 hot | v3.7 hot (thr=2.0) |
|--------|---|------------|---------------------|
| HC3 ChatGPT (en AI) | 100 | **66.0%** | **76.0%** |
| HC3 human (en) | 100 | 12.0% | 19.0% |
| Wikipedia (en) | 100 | 23.0% | **25.0%** |
| NamuWiki (ko) | 100 | 11.0% | 13.0% |

Pareto frontier (3-signal OR, threshold sweep):

| lex_thr | AI% | HC3% | Wiki% | Namu% | utility |
|---------|-----|------|-------|-------|---------|
| 0.5–2.5 (plateau) | 76.0 | 19.0 | 25.0 | 13.0 | +51 |
| 3.0 | 76.0 | 17.0 | 25.0 | 13.0 | +51 |
| 5.0 | 76.0 | 15.0 | 25.0 | 13.0 | +51 |
| v3.5.1 baseline | 66.0 | 12.0 | 23.0 | 11.0 | +43 |

### Acceptance criteria — 충족

| 기준 | 목표 | 실측 |
|------|------|------|
| AI catch (HC3 ChatGPT) | ≥ 75% | **76.0%** ✓ |
| max human FP | ≤ 25% | **25.0%** ✓ (Wikipedia, 경계) |
| NamuWiki 회귀 | v3.5.1 +5pp 이내 | 11% → 13% (+2pp) ✓ |

3개 기준 모두 충족 → v3.7 ship 결정.

### Threshold 선택 근거

`density_threshold = 2.0` 채택. 0.5–5.0 plateau 구간 어디에서도 동일한 catch/FP 가 나오므로 사양 기본값(2.0) 을 사용한다. 운용 의미: "1,000 토큰당 AI lexicon entry 가 2개 초과로 나타나면 단락 의심". 이는 사양 §3 Recommendation 과 일치한다.

### Calibration drop list

초기 lexicon 후보 중 다음 entry 들은 sweep 결과 사람 텍스트(특히 Wikipedia 백과사전체) 발화율이 AI 발화율과 같거나 높아 제외했다.

- Strict (drop): `intersection`, `principles`, `mindset`, `iterative`, `responsible`, `methodologies`, `redefine`, `accessible`, `equitable`
- Phrases (drop): `one of the most`, `in conjunction with`, `the power of`

이 entry 들은 학술/전문 prose 에서 자연스럽게 등장하는 단어로, AI 의 promotional 어휘가 아니라 register 의 일부였다. 재추가 시 반드시 `.omc/research/v3_7_lexicon_eval.py` 로 회귀 측정.

### 28-패턴 카탈로그와의 분리

lexicon 은 다음 카탈로그 항목과 **중복되지 않도록** 큐레이션됐다:

- `en-language.md` Pattern 7 (delve, tapestry, multifaceted, leverage 등 30개) — 카탈로그가 이미 다룸
- `en-content.md` Pattern 1, 4 (groundbreaking, transformative — paradigm shift 등 promotional 형용사) — 카탈로그가 이미 다룸
- `ko-language.md` Pattern 7, 8 (다양한, 활발한, 혁신적인, ~적 접미사 등) — 카탈로그가 이미 다룸
- `ko-style.md` Pattern 13, 18 (이를 통해, 도모하다, 본 사업 등) — 카탈로그가 이미 다룸

lexicon 의 50+58/41+49 entry 는 위 패턴들이 명시적으로 잡지 않는 영역(modal scaffolding, 추상명사, 의례적 도입/마무리 phrase) 만 추렸다.

### 한국어 lexicon 의 검증 결과 (post-v3.7.0)

§14 의 ko/AI 100 단락(Claude 자가 생성) 측정에서 한국어 lexicon 발화는 9/100. burstiness 신호(82/100 발화) 위에 추가 +1 단락만 hot 으로 잡았다. 영어 lexicon (HC3 ChatGPT 에서 +10pp) 대비 한국어 효과는 미미하다.

원인 추정:
1. Claude 가 생성한 한국어 prose 가 한국어 lexicon 큐레이션 항목(예: `시너지 효과`, `패러다임의 전환`) 을 거의 사용하지 않음 — Claude 의 한국어 register 는 영어 ChatGPT 의 영어 register 와 다른 어휘 분포를 보임
2. 한국어 lexicon 의 `~` wildcard phrase 가 substring 매칭으로 변환될 때 실제 텍스트와 어절 경계가 불일치하는 경우가 많음
3. 90 entries 중 일부가 너무 학술적/공식적 — 일반 prose register 와 mismatch

운용상 결론: 한국어에서는 burstiness 가 거의 단독으로 신호 역할을 한다 (catch rate 82%). 한국어 lexicon 은 백업/안전망 정도로 유지하되, v3.8 후보로 한국어 lexicon 재큐레이션 (실제 Claude/GPT 한국어 출력 mining 기반) 을 두는 것이 합리적이다.

### 운용상 권고

v3.7 도 advisory marker 다. 28-패턴 카탈로그의 보조 입력이며, 단독 결정 신호로 쓰기엔 catch rate(76%) 가 여전히 부족하다. 단락이 hot 표시되면 LLM 이 우선 검토하고, 표시되지 않더라도 패턴 단계가 정상 작동한다. v3.5.1 운용 권고와 동일.

### 재현

`.omc/research/v3_7_lexicon_eval.py` 로 측정. raw 결과는 `.omc/research/v3_7_results.json` (paragraph-level: text + cv + mattr + lex_density + lex_hits). 재실행 시 HuggingFace `Hello-SimpleAI/HC3` + `wikimedia/wikipedia` 20231101.en + `heegyu/namuwiki` 다운로드 발생.
