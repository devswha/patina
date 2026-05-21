---
name: Stylometric Suspect-Zone Detection
version: 2.2.0
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
- 외부 의존성(형태소 분석기, 외부 detector API) 없이 ko/en은 whitespace 토큰화,
  zh/ja는 deterministic character-token fallback으로 동작한다

이 알고리즘은 5a 구조 분석 단계와 5b 문장/어휘 단계에 자연스럽게 결합되도록 설계되었다.
- 5a는 단락 수준 hot 표시를 우선 검토 대상으로 사용한다
- 5b는 문장 수준 hot 그룹을 우선 재작성 대상으로 사용한다

### 언어 범위

| 언어 | 지원 | 비고 |
|------|---------|------|
| ko | yes | 어절 단위 토큰화 |
| en | yes | 단어 단위 토큰화 |
| zh | yes | Han character-token fallback |
| ja | yes | Kana/Han character-token fallback; 형태소 분석 없음 |

기본 `stylometry.languages`는 `[ko, en, zh, ja]`이다. 사용자가 설정에서 언어를 제거하면
해당 언어는 4.6단계를 skip 한다.

---

## 2. Tokenization Policy

외부 의존성을 배제하기 위해 형태소 분석기 없이 토큰화한다. ko/en은 whitespace +
edge-punctuation strip, zh/ja는 Han/Kana 문자와 ASCII run을 token으로 삼는 fallback을
사용한다. raw token만으로도 burstiness와 MATTR 신호는 충분히 안정적이다.

### 절차

```
tokens = []
IF language is zh or ja:
    FOR each Han/Kana character or ASCII alnum run IN sentence:
        tokens.append(match)
ELSE:
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
| zh | 한자 문자 | `工具提升写作` | `[工, 具, 提, 升, 写, 作]` |
| ja | 가나/한자 문자 | `道具が書く` | `[道, 具, が, 書, く]` |

> **주의:** 한국어는 어절 기준이므로 morpheme-level 분석과 다르다. `도구는`과 `도구가`는
> 서로 다른 토큰으로 취급된다. zh/ja 역시 형태소 단위가 아니라 문자 fallback이다. jieba,
> sudachi, mecab 같은 형태소 분석기는 배포 의존성과 설치 실패면을 늘리므로 기본 경로에서
> 제외한다.

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
- 단락 문장이 3개 미만이면 CV 값은 기록하되 burstiness band는 부여하지 않는다.
  2문장 이하 샘플은 길이 변동성이 너무 불안정해서 hot 판정에서 제외한다.

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
| 단락 내 문장 수 < 3 | CV 값은 기록하지만 burstiness band/hot 판정은 생략 → MATTR/lexicon 만 평가 |
| 단락 내 토큰 수 = 0 | 해당 단락 skip |
| 언어가 `stylometry.languages` 에 없음 | 4.6단계 전체 skip (기본값은 ko/en/zh/ja 포함) |

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

현재 기본 경로에서 의도적으로 제외했거나 ship 이후 후속 검토만 남은 항목.

**zh/ja decision:** 기본 경로는 char-token fallback으로 확정한다. go 조건은 "무의존성,
Node 18 호환, 문장 길이 CV/MATTR가 공백 없는 zh/ja 문장에서 0-token으로 붕괴하지 않음"이다.
jieba/sudachi/mecab 같은 형태소 의존성은 no-go다. go 조건을 다시 열려면 (1) pure JS 또는
optional dependency로 설치 실패가 없는 경로, (2) ko/en/zh/ja benchmark에서 false positive
증가가 허용 범위 내라는 근거, (3) 패키지 크기/속도 회귀가 문서화되어야 한다.

| 항목 | 설명 | 도입 후보 시점 |
|------|------|----------------|
| ~~n-gram redundancy~~ | ~~bi/trigram 반복도~~ — **dropped, §15 negative finding** | — |
| ~~AI-lexicon overlap~~ | ~~28-패턴 외 AI 특유 어구 사전 매칭~~ — **shipped v3.7, §16** | v3.7 |
| ~~zh/ja character fallback~~ | ~~Han/Kana character-token burstiness/TTR~~ — **shipped for 4.6** | current |
| Perplexity proxy | small LM 또는 cloze prompt 기반 token-level surprise | v4 후보 |
| Function-word distribution | 기능어 빈도 분포 차이 (Mosteller & Wallace 류) | v4 후보 |
| GPTZero / Originality 연동 | 외부 detector API 결과를 hot 신호로 합산 | v4+ 후보 |
| 형태소 분석 기반 ko 토큰화 | 어절 → 형태소 단위로 정밀화 | v2+ |
| zh/ja 형태소 분석 통합 | 단어 경계 처리; 위 go/no-go 충족 시에만 재검토 | v4+ 후보 |
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
- **Language scope**: 4.6 stylometry는 ko/en/zh/ja를 지원한다. zh/ja는 형태소가 아니라
  character-token fallback이므로 MATTR 해석은 보수적으로만 사용한다. 4.7 lexicon도
  en/ko/zh/ja 기본 사전을 제공한다.

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
- `lexicon/ai-ko.md` — 한국어 49개 strict + 53개 phrase = 102 entries
- `lexicon/ai-zh.md` — 중국어 60개 phrase = 60 entries
- `lexicon/ai-ja.md` — 일본어 60개 phrase = 60 entries

탐색은 `Glob lexicon/ai-{lang}.md`로 자동. 기본 `lexicon.languages`는
`[en, ko, zh, ja]`이다. 사용자가 `custom/lexicon/ai-{lang}.md` 를 두면 우선 로드.

### 매칭 정책

- **Strict matches** (Markdown `## Strict matches` 섹션): 대소문자 무시 whole-word 매칭. CJK(ko/zh/ja)는 substring으로 근사 — 한국어 어절과 zh/ja character fallback에서 multi-character entry가 통째 token으로 남지 않기 때문이다
- **Multi-word phrases** (Markdown `## Multi-word phrases` 섹션): 대소문자 무시 substring 매칭. `~` 가 포함된 phrase(예: `~의 지평을 넓히다`, `不仅~而且`, `~と言えるでしょう`)는 `~` 을 wildcard 로 취급 (`.{0,40}`)
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

lexicon 의 en 108 / ko 102 / zh 60 / ja 60 entry 는 위 패턴들이 명시적으로 잡지 않는 영역(modal scaffolding, 추상명사, 의례적 도입/마무리 phrase) 만 추렸다.

### zh/ja lexicon 스타터 팩 (v3.11.x)

`lexicon/ai-zh.md`와 `lexicon/ai-ja.md`는 각각 60개 phrase-only entry로 시작한다.
두 언어는 whitespace token이 안정적이지 않으므로 모든 기본 entry를 `Multi-word phrases`
섹션에 두고 substring/wildcard 매칭으로 처리한다. 회귀 fixture에는 lexicon-only hot
샘플과 natural cold counterexample을 각 언어별로 추가했으며, `npm run benchmark` 기준
zh/ja 모두 false positive 0/4, AI catch 4/4를 유지한다. 더 큰 외부 corpus로 확장할 때는
각 파일의 counterexample table을 먼저 검토하고, 백과사전·뉴스 register에서 비슷하게
발화하는 entry는 drop한다.

### 한국어 lexicon 의 검증 결과 + v3.8.0 재큐레이션

**v3.7.0 (90 entries) 측정**: ko/AI 100 단락(Claude 자가 생성) 에서 한국어 lexicon 발화는 9/100. burstiness 신호(82/100) 위에 +1 단락만 추가. 영어 lexicon (HC3 ChatGPT 에서 +10pp) 대비 한국어 효과 미미.

**v3.8.0 (102 entries) 재큐레이션**:

ko/AI 코퍼스 vs NamuWiki human 차별 빈도 마이닝(`.omc/research/v3_8_ko_lexicon_mine.py`) 으로 AI 측 doc-freq ≥4×, ratio ≥4.0 인 phrase 발굴. 도메인 아티팩트(`가면라이더`, `한국`, `시리즈` 등) 제외하고 register marker 12개 추가:

- Strict (8개): `평가된다`, `꼽힌다`, `가리킨다`, `사례로`, `다수의`, `알려져`, `일컬어진다`, `평가받다`
- Phrases (4개): `가운데 하나로`, `자리 잡았다`, `알려져 있다`, `~의 사례로`

**v3.8.0 결과** (동일 코퍼스 재측정, `.omc/research/v3_8_remeasure.py`):

| Source | n | v3.7.0 hot | v3.8.0 hot | Δ | lex fires |
|--------|---|-----------:|-----------:|---:|---------:|
| ko_ai (Claude) | 100 | 83% | **91%** | **+8pp** | 9 → 52 |
| namu_human FP | 100 | 13% | **13%** | **0pp** | 0 → 2 |
| hc3_ai (en) | 100 | 76% | 76% | — | (en lex unchanged) |
| hc3_human FP | 100 | 19% | 19% | — | — |
| wiki_human FP | 100 | 25% | 25% | — | — |

**Clean Pareto 개선** — Korean human FP 0pp regression, AI catch +8pp. 신규 entry 가 AI 측에서 강하게 (52/100 fires) 사람 측에서 약하게 (2/100 fires) 발화. 한국어 catch rate 91% 는 시스템 전체에서 가장 강한 신호.

**근본 원인 — 왜 v3.7.0 한국어 lexicon 은 약했는가**:

v3.7.0 lexicon 큐레이션은 저자(Track B)의 한국어 AI 직관에 의존했다. 실제 Claude 출력은 그 직관과 어휘 분포가 달랐다(`시너지 효과`, `패러다임의 전환` 같은 비즈니스 외래어를 별로 안 씀; 대신 백과사전체 passive 종결 `평가된다`, `가리킨다`, `꼽힌다` 를 자주 씀). v3.8.0 마이닝은 직관 대신 paired corpus 의 통계적 차별로 발굴 — 더 실증적.

**v3.8 운용 권고**: 한국어에서 lexicon 이 burstiness 와 함께 의미있는 보조 신호로 작동하기 시작했다(91%). 영어 측은 v3.7.0 시점의 직관 큐레이션이 그대로 잘 작동(+10pp 기여). 영어 lexicon 도 향후 paired corpus 마이닝으로 재검토 가능 — v4 후보.

### 운용상 권고

v3.7 도 advisory marker 다. 28-패턴 카탈로그의 보조 입력이며, 단독 결정 신호로 쓰기엔 catch rate(76%) 가 여전히 부족하다. 단락이 hot 표시되면 LLM 이 우선 검토하고, 표시되지 않더라도 패턴 단계가 정상 작동한다. v3.5.1 운용 권고와 동일.

### 재현

`.omc/research/v3_7_lexicon_eval.py` 로 측정. raw 결과는 `.omc/research/v3_7_results.json` (paragraph-level: text + cv + mattr + lex_density + lex_hits). 재실행 시 HuggingFace `Hello-SimpleAI/HC3` + `wikimedia/wikipedia` 20231101.en + `heegyu/namuwiki` 다운로드 발생.
