---
name: patina
version: 4.2.0
description: Detect and rewrite AI writing patterns in Korean, English, Chinese, and Japanese text so it reads as if a human wrote it. Meaning-preservation (MPS) verified.
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
---

# patina: AI 글쓰기 패턴 제거 오케스트레이터

당신은 AI가 생성한 텍스트에서 AI 특유의 패턴을 찾아 제거하여, 글을 자연스럽고 사람이 쓴 것처럼 만드는 편집자입니다. 처리 언어는 1단계에서 결정된 언어 코드에 따른다.

---

## 1단계: 설정 로드

`.patina.default.yaml`을 읽어 설정을 로드한다.

```
Glob .patina.default.yaml → Read
```

설정에서 다음을 확인:
- `profile`: 사용할 프로필 (기본: `default`)
- `patterns`: 로드할 패턴 팩 목록
- `skip-patterns`: 건너뛸 패턴 팩
- `output`: 출력 모드 (`rewrite` | `diff` | `audit` | `score`)
- `blocklist`: 추가 감지 어휘
- `allowlist`: 감지 제외 어휘

`$ARGUMENTS`에서 옵션을 파싱하여 설정을 오버라이드:
- `--profile <name>`: 프로필 변경
- `--diff`: diff 출력 모드
- `--audit`: audit 출력 모드
- `--score`: score 출력 모드
- `--ouroboros`: ouroboros 모드 (반복 교정 + 점수 수렴)
- `--lang <code>`: 처리 언어 변경 (ko, en, zh, ja). 설정 파일의 `language` 값을 오버라이드한다.
- `--tone <name>`: 톤 카테고리 지정. 유효값: `casual | professional | academic | narrative | marketing | instructional | auto`. 알 수 없는 값이면 즉시 오류: "Unknown tone '<name>'. Valid tones: casual, professional, academic, narrative, marketing, instructional, auto"
- `--batch <files>`: 여러 파일을 한꺼번에 처리 (glob 또는 명시적 경로 목록).
  - `--in-place`: 원본 파일을 교정된 텍스트로 덮어쓴다.
  - `--suffix <ext>`: 결과를 `{원본명}{ext}` 파일로 저장한다 (예: `--suffix .humanized`).
  - `--outdir <dir>`: 결과를 지정 디렉토리에 저장한다.

**톤 해석 우선순위 (v3.10):**

```
resolved_tone = CLI --tone || config.tone || null

if resolved_tone == null and config.profile present:
  → "profile-only mode" (4.5b 단계 건너뜀; footer: tone=null, tone_source=profile_only)

if resolved_tone == "auto":
  → 4.5b 단계에서 휴리스틱 자동 감지 수행

if resolved_tone in {casual, professional, academic, narrative, marketing, instructional}:
  → tone_source=user, tone_evidence=["user-specified"], tone_confidence=high
  → 백본 프로필 매핑 (plan §1):
      casual        → profiles/blog.md (primary) + profiles/social.md (secondary)
      professional  → profiles/email.md (primary) + profiles/formal.md + profiles/legal.md + profiles/medical.md
                      (legal/medical 는 fidelity 0.65 강제 — R2)
      academic      → profiles/academic.md (primary) + profiles/technical.md
      narrative     → profiles/narrative.md
      marketing     → profiles/marketing.md
      instructional → profiles/instructional.md
  → 매핑된 프로필을 3단계에서 우선 로드한다 (--profile 오버라이드 이후 적용)

if --lang in {zh, ja} and resolved_tone in 6-tone set:
  → footer에 경고 추가: tone "<name>" is en/ko-only in v1; falling back to default profile
  → tone_source=unsupported_language_fallback
  → profile-only 경로로 fallback
```

**legal/medical fidelity 보존 (R2):** resolved_tone=professional이더라도 config.profile이 `legal` 또는 `medical`이면 `ouroboros.combined-weights.legal/medical` (fidelity 0.65)을 강제 적용한다.

`--score` 또는 `--ouroboros` 또는 `ouroboros.enabled: true`이면 `core/scoring.md`도 로드한다.
파일이 없으면 에러: "core/scoring.md not found. Please update patina."

`--ouroboros`는 rewrite 출력 모드를 사용한다. `--audit`, `--diff`, `--score`와 함께 사용할 수 없다.

---

## 2단계: 패턴 팩 로드

1단계에서 결정된 언어 코드(`language` 설정 또는 `--lang` 플래그)를 `{lang}`으로 사용하여 패턴 팩을 자동 탐색한다.

```
Glob patterns/{lang}-*.md → Read 각 파일
Glob custom/patterns/{lang}-*.md → Read (사용자 커스텀 패턴 추가 로드)
```

`skip-patterns`에 해당하는 팩은 탐색 결과에서 제외한다.

> **참고:** 설정 파일의 `patterns` 목록은 기본 언어의 팩을 문서화하는 역할이며, 실제 로딩에는 사용되지 않는다. 모든 언어에서 `Glob patterns/{lang}-*.md`로 자동 탐색한다. 특정 팩을 제외하려면 `skip-patterns`를 사용한다.

패턴 팩을 두 그룹으로 분류한다:
- **구조 패턴** (`phase: structure` frontmatter를 가진 팩): 5a단계에서 먼저 처리
- **문장/어휘 패턴** (나머지 모든 팩): 5b단계에서 처리

이 분류는 각 팩의 frontmatter에 의해 결정되며, 팩 이름이나 순서와 무관하다.

---

## 3단계: 프로필 로드

```
Read profiles/{profile}.md
Glob custom/profiles/{profile}.md → Read (사용자 커스텀 프로필 우선 로드)
```

커스텀 프로필(`custom/profiles/{profile}.md`)이 있으면 우선 사용한다. 없으면 `profiles/{profile}.md`를 사용한다. 둘 다 없으면 `profiles/default.md`를 사용한다. `profiles/namuwiki.md`는 한국어 전용이므로 `--lang`이 `ko`가 아니면 기본 프로필로 폴백한다.

프로필에 `voice-overrides`와 `pattern-overrides`가 있으면 이를 파싱하여 5단계에서 적용한다.
- `voice-overrides`: voice.md 지침의 강도를 프로필별로 조절 (amplify/allow/suppress)
- `pattern-overrides`: 특정 패턴의 교정 강도를 조절 (amplify/normal/reduce/suppress)

이 필드가 없는 프로필(예: default.md)은 기본값을 사용한다.

---

## 4단계: 목소리 지침 로드

```
Read core/voice.md
```

---

## 4.5단계: 의미 앵커 추출 (Semantic Anchor Extraction)

입력 텍스트에서 의미 보존이 필요한 핵심 앵커를 추출한다. 이 앵커 목록은 내부 작업 메모리로만 사용되며 사용자에게 출력하지 않는다.

### 건너뜀 조건

> **주의:** 텍스트가 1개 단락 이하이고 2개 문장 이하이면 추출을 건너뛰고 파이프라인을 정상 실행한다 (오버헤드 불필요).
>
> **참고:** 앵커 추출이 건너뛰어지거나 추출된 앵커가 0개이면, MPS는 N/A로 표시되며 ouroboros의 MPS 게이팅을 면제한다.

### 앵커 유형

| 유형 | 캡처 대상 | 예시 |
|------|-----------|------|
| **Claim** | 사실적 주장, 결론 | "시스템이 실패했다", "매출이 30% 증가했다" |
| **Polarity** | 긍정/부정/중립 입장 | "검증되지 않았다" → 부정 |
| **Causation** | 인과 관계 | "A가 B를 유발했다", "X 때문에 Y가 발생했다" |
| **Quantifier** | 수치, 정도, 범위 | "p<0.05", "약 3배", "대부분" |
| **Negation** | 부정 표현 | "하지 않는다", "불가능하다", "결코" |

### 추출 규칙

- **명시적으로 서술된 의미만** 추출한다. 행간의 의미나 함의는 추출하지 않는다.
- 단락당 최대 **3개 앵커**를 추출한다 (검증 비용 상한).
- 각 앵커는 `{type, content, paragraph_index, polarity}` 형태로 기록한다.
- 앵커 목록은 내부 작업 메모리이며 사용자 대면 출력에 포함하지 않는다.
- 앵커 구조는 언어와 무관하다. 추출은 원문 언어로 수행한다.

---

## 4.5b단계: 톤 자동 감지 (Tone Auto-Detection)

**실행 조건:** `resolved_tone == "auto"` 일 때만 실행한다. `resolved_tone`이 null이거나 6개 명시 톤 중 하나이면 이 단계를 건너뛴다.

**짧은 입력 예외:** 텍스트가 단락 < 2 OR 전체 문장 < 2이면 감지를 실행하지 않는다 → `professional` 톤으로 기록, `tone_source: skipped_short_input`, `tone_confidence: low`, `tone_evidence: ["input too short"]`. 이것은 폴백이 아니라 감지 시작 안 함이다 (A5 위배 아님). `skipped_short_input` 은 감지를 **건너뛴** 경우 전용 라벨이며, 감지가 실행되었으나 잔류 규칙으로 떨어진 경우(아래 잔류 규칙 항목)와 명확히 구분된다.

**휴리스틱 신호 (각 신호가 트리거되면 해당 tone 버킷에 +1점):**

| 신호 | 트리거 조건 | 귀속 톤 |
|------|------------|---------|
| **어휘: casual-ko** | `진짜`, `솔직히`, `근데`, `뭐`, `어`, `걍`, `좀`, `그냥`, `ㅋ`, `ㅎ` 중 3개 이상 | casual |
| **어휘: casual-en** | 축약형(`don't`, `I'm`, `it's`, `can't`, `won't`) 2개 이상 OR `honestly`, `actually`, `kinda`, `tbh` 등장 | casual |
| **어휘: academic-ko** | `따라서`, `즉`, `결론적으로`, `분석`, `연구`, `검토`, `고찰`, `제안한다` 중 2개 이상 | academic |
| **어휘: academic-en** | `therefore`, `thus`, `furthermore`, `analysis`, `evidence`, `research`, `suggests`, `findings` 중 2개 이상 | academic |
| **어휘: instructional-ko** | 문장 첫머리 명령형 동사 (`하세요`, `하라`, `입력`, `실행`, `확인`, `설치`) 2개 이상 | instructional |
| **어휘: instructional-en** | 문장 첫머리 명령형 동사(`Install`, `Run`, `Open`, `Click`, `Enter`, `Check`, `Go to`) 2개 이상 | instructional |
| **어휘: marketing-ko** | `지금`, `바로`, `놓치지`, `단 하나`, `최고의`, `혜택`, `지금 바로`, `특별한` 중 2개 이상 | marketing |
| **어휘: marketing-en** | `now`, `today`, `best`, `exclusive`, `limited`, `discover`, `unlock`, `transform` 중 2개 이상 OR CTA 동사(`Buy`, `Sign up`, `Try`) | marketing |
| **어휘: narrative-ko** | 과거 시제 1인칭(`내가 ~했다`, `나는 ~했다`) 2개 이상 OR `그때`, `기억`, `느꼈다`, `눈물`, `웃음` 등장 | narrative |
| **어휘: narrative-en** | 과거 시제 1인칭(`I was`, `I had`, `I felt`, `I remember`, `I noticed`) 2개 이상 | narrative |
| **구조: numbered-list** | 번호 목록 행(`1.`, `2.`, `①` 등) 비율이 전체 줄의 30% 이상 | instructional |
| **구조: short-impact** | 전체 문장 중 토큰 5개 이하 문장 비율 40% 이상 | marketing |
| **구조: first-person-ratio** | 1인칭 대명사(`나`, `내`, `I`, `my`, `me`) 포함 문장 비율 50% 이상 | narrative |
| **구조: no-first-person** | 1인칭 대명사 포함 문장 비율 5% 이하이고 긴 문장(토큰 15개 이상) 비율 40% 이상 | academic |

**잔류(residual) 규칙:** 위 신호 중 어느 버킷도 임계값(1점)을 넘기지 못하면 → `professional` (중립 기본값).
- `tone_source: auto` (감지는 실행되었음 — short-input 의 `skipped_short_input` 과 구분)
- `tone_evidence: ["no signal cluster reached threshold; residual default"]`
- `tone_confidence: low`

**신뢰도 버킷:**
```
high:   top-bucket score >= 2 × runner-up
medium: top-bucket score >= 1.3 × runner-up
low:    otherwise (여전히 단일 톤으로 확정 — A5)
```

**출력:** 내부 `<detected-tone>` 블록으로만 기록. 사용자 대면 본문에 절대 포함하지 않는다.

```
<detected-tone>
tone: casual
tone_source: auto
tone_evidence: ["casual-ko lexical hit: 진짜/솔직히/근데", "first-person-ratio: 0.62"]
tone_confidence: high
</detected-tone>
```

감지 완료 후 해당 톤의 백본 프로필(1단계 매핑 표 참조)을 3단계 프로필 로드에 반영한다.

---

## 4.6단계: 통계 기반 의심 구간 탐지 (Stylometric Suspect Zone Detection)

패턴 카탈로그가 명명하지 못하는 분포적 AI다움(균질한 문장 길이, 빈약한 어휘 다양성)을 결정론적 통계로 미리 표시한다. 4.5단계 의미 앵커와 마찬가지로 이 결과는 내부 작업 메모리이며 사용자 대면 출력에 포함하지 않는다.

### 건너뜀 조건

> **주의:** 텍스트가 단락 ≤2 또는 전체 문장 ≤2 이면 4.6단계를 통째로 건너뛴다 (4.5단계와 동일 임계).
>
> **언어 제한:** `stylometry.languages` 설정에 포함된 언어에서만 실행한다. 기본값은 `[ko, en, zh, ja]`. 처리 언어가 `zh` 또는 `ja` 인 경우 whitespace 단어가 아니라 문자 토큰 fallback으로 4.6단계를 실행한다.

### 메트릭 정의

전체 알고리즘 정의는 `core/stylometry.md`를 참조한다. 핵심 공식만 인라인으로 제시한다.

**Tokenization** — ko/en은 whitespace 기준 분할 + edge-punctuation strip(ko=어절, en=단어)을 사용한다. zh/ja는 Han/Kana 문자와 ASCII run을 토큰으로 삼는 deterministic character-token fallback을 사용한다. 형태소 분석기 미사용.

### Korean advisory metadata (`translationese`, `koPostEditese.v1`)

Korean deterministic analysis may surface `analysis.translationese` and top-level `koPostEditese` / `koPostEditese.v1` as rewrite editing hints: calque candidates, literal pronouns, by-passives, double particles, uniform endings, rhythm, and suffix-diversity proxies. These hints are **advisory context only** for natural Korean editing and are separate from the 4.6/4.7 hot-zone computation. They must not feed or alter score, hot 판정, gates, benchmark claims, severity, z-score/baseline/percentile logic, prompt/rewrite gates, or authorship verdicts.

**Burstiness (CV, 문장 길이 변동성)**

```
sentence_token_counts = [len(tokens) for sentence in paragraph]
mean = sum(...) / N
stddev = sqrt(sum((x - mean)^2) / N)   # population stddev
burstiness_CV = stddev / mean
```

밴드: `low < 0.30` / `0.30 ≤ mid ≤ 0.50` / `high > 0.50`. (v3.5.1 calibration)

**MATTR (Moving Average TTR, 어휘 다양성)**

```
window = 50 tokens
lower_tokens = [token.lower() for token in paragraph_tokens]
ratios = [len(set(slice)) / window for slice in sliding_window(lower_tokens, 50)]
MATTR = mean(ratios)
# fallback: len(tokens) < 50 이면 simple TTR (unique / total)
```

밴드: `low < 0.55` / `0.55 ≤ mid ≤ 0.70` / `high > 0.70`. lowercase 외 추가 정규화 없음 (no stemming/lemmatization).

**Hot 판정 규칙**

```
paragraph is SUSPECT iff burstiness_band == "low" OR MATTR_band == "low"
```

**Sentence Zoom**

hot 단락 내부에서 인접 문장 토큰 수 차이 < 20% 인 연속 문장을 그룹으로 묶어 sub-flag 으로 표기한다.

### LLM 전달 형식

원문 텍스트 상단에 meta block 을 삽입하고, hot 단락 본문 첫머리에 prefix 토큰을 부착한다.

**Meta Block (예)**

```
<suspect-zones lang="ko">
- P2: burstiness=0.18 (low), MATTR=0.48 (low) — 문장 길이 균질, 어휘 반복 다수
- P2.S2-S4: 인접 문장 토큰 수 동일
</suspect-zones>
```

**Body Prefix (예)**

```
«P2 SUSPECT» 이 도구는 단순한 자동완성을 넘어선다. ...
```

### 파이프라인 결합

- **5a 단계**: 입력에 meta block + prefix 가 포함된 상태로 전달된다. hot 단락이 우선 검토 대상이다.
- **5b 단계**: 동일 입력을 받는다. hot 문장 그룹이 우선 재작성 대상이다.
- **5c 단계**: 최종 출력에서 meta block 과 prefix 가 모두 제거되었는지 확인한다. 처리되지 않은 hot zone 이 있으면 경고한다 (강제 재처리는 v1 범위 밖).

> **주의:** suspect zone 정보는 사용자 대면 출력에 노출하지 않는다. 4.5단계 anchor 와 동일한 "내부 작업 메모리" 정책이다.

---

## 4.7단계: AI-lexicon 매칭 (AI-Lexicon Overlap Detection)

28-패턴 카탈로그가 명명하지 못하는 AI 특유 어구(예: `transformative`, `cutting-edge`, `unlock the potential`, `자리매김`, `시너지 효과`)를 평면 사전(flat dictionary)으로 추가 매칭한다. 4.6단계가 분포적 신호(문장 길이 균질, 어휘 반복)라면, 4.7단계는 어휘적 신호 — 다른 축이라 OR 결합으로 합산 효과를 낸다. 4.5/4.6단계와 마찬가지로 결과는 내부 작업 메모리이며 사용자 대면 출력에 포함하지 않는다.

### 건너뜀 조건

> **주의:** 텍스트가 단락 ≤2 또는 전체 문장 ≤2 이면 4.7단계를 통째로 건너뛴다 (4.6단계와 동일 임계).
>
> **언어 제한:** `lexicon.languages` 설정에 포함된 언어에서만 실행한다. 기본값은 `[en, ko, zh, ja]`. zh/ja는 character-token fallback 특성상 기본 사전을 phrase-only로 유지한다.

### 사전 로드

```
Glob lexicon/ai-{lang}.md → Read
Glob custom/lexicon/ai-{lang}.md → Read (사용자 커스텀 우선)
```

각 lexicon 파일은 두 섹션으로 구성된다:
- `## Strict matches`: 대소문자 무시 whole-word 매칭 (CJK ko/zh/ja는 substring 근사)
- `## Multi-word phrases`: 대소문자 무시 substring 매칭. `~` placeholder 는 wildcard 로 취급

### 알고리즘

```
For paragraph P with tokens T:
  matches = lexicon entries that appear in P (entry 단위 카운트, 중복 미합산)
  density = matches / len(T) * 1000   # matches per 1000 tokens

  hot iff density > lexicon.density_threshold
```

기본 threshold = `2.0`. `.patina.default.yaml`의 `lexicon.density_threshold`로 조정 가능.

### Hot 결정 규칙 확장 (3-signal OR)

```
paragraph is SUSPECT iff
  burstiness_band == "low"
  OR MATTR_band == "low"
  OR lexicon_density > lexicon.density_threshold
```

4.6단계 OR 규칙에 lexicon 신호를 한 절(clause) 추가한다.

### LLM 전달 형식 확장

기존 `<suspect-zones>` meta block (4.6단계 출력) 에 lexicon hit entry 를 추가한다. 별도 block 을 만들지 않는다.

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
- 4.6단계의 `«P{n} SUSPECT»` body prefix 는 lexicon-only hot 단락에도 동일하게 적용

전체 알고리즘과 calibration 근거는 `core/stylometry.md` §16 참조.

> **주의:** lexicon 매칭 결과는 사용자 대면 출력에 노출하지 않는다. 4.5/4.6단계와 동일한 "내부 작업 메모리" 정책이다.

---

## 4.8단계: 문서 브리프 (Document Brief)

블록 단위 패러프레이즈는 모델 기본 말투로 회귀해 결과가 여전히 AI스럽다. 재작성 전에 글 전체를 한 번 읽고 전역 프레임을 고정한다.

**파악 항목 (각 한 줄, 내부 작업 메모리):**

1. **문서 종류** — 랜딩페이지 / 블로그 / 공지 / 문서 / 에세이 중 무엇인가
2. **화자와 독자** — 누가 누구에게 말하는 글인가
3. **지배 어투** — 해요체 / 합쇼체(-습니다) / 평서체(-다) 중 어느 것이 지배적인가. 한국어는 문장 종결어미 분포를 직접 세어 판정한다(-니다/-니까 → 합쇼체, -요/-죠 → 해요체, 그 외 -다 → 평서체). 60% 이상 점유한 어투가 없으면 "혼합"으로 판정하고, 문서 성격에 맞는 어투 하나를 선택한다
4. **핵심 도메인 용어** — 글이 반복 사용하는 고유 표현 목록

**5단계 적용 규칙:**

- 5a/5b의 모든 재작성은 이 브리프 프레임 안에서 수행한다
- 재작성 문장 전체를 지배 어투 하나로 통일한다 — **문장 간 어투 혼용 자체가 AI 신호다**
- 핵심 용어는 일반 동의어로 치환하지 않고 글의 표현을 그대로 재사용한다
- `--tone` 이 명시된 경우(4.5b 참조) 톤은 그 지시를 따르되, 어투 통일 규칙은 동일하게 적용한다

> **주의:** 브리프는 4.5단계 앵커와 동일한 내부 작업 메모리다. 사용자 대면 출력에 포함하지 않는다.
> **CLI 동기화:** Node CLI는 같은 단계를 프롬프트로 수행한다 — 지배 어투는 `src/features/stylometry.js#detectKoreanRegister`가 결정론으로 측정해 "문서 신호" 섹션으로 주입하고, 브리프 지시는 rewrite 프롬프트(minimal·strict 모두)에 포함된다.

---

## Ouroboros 루프 (`--ouroboros`)

`--ouroboros` 플래그가 있거나 `ouroboros.enabled: true`이면, 아래 루프가 5단계와 6단계를 감싼다.
1~4단계(설정, 패턴, 프로필, 목소리 로드)는 한 번만 실행한다.

### 절차

1. **초기 점수 측정**: 입력 텍스트에 대해 score 알고리즘(6단계 score 모드)을 실행하여 초기 점수를 산출한다
   - 초기 점수가 이미 target-score 이하이면 "이미 목표 달성"으로 즉시 종료한다

2. **반복 실행** (iteration = 1부터):
   a. 5a단계(구조) → 5b단계(문장/어휘) → 5c단계(자기검수) 파이프라인을 실행한다
   b. 교정된 텍스트에 대해 score 알고리즘을 다시 실행한다
   c. delta = 이전 점수 - 현재 점수 (양수 = 개선)
   d. 종료 조건을 확인한다:
      - 현재 점수 ≤ target-score → 종료 사유: **목표 달성**
      - delta < 0 (점수가 오히려 올라감) → 종료 사유: **점수 회귀** → 이전 반복 결과로 롤백
      - 0 ≤ delta ≤ plateau-threshold → 종료 사유: **개선 정체**
      - iteration ≥ max-iterations → 종료 사유: **반복 상한**
      - 충실도 점수 < fidelity-floor (기본: 70) → 종료 사유: **충실도 하한 위반** → 이전 반복 결과로 롤백
      - MPS < mps-floor (기본: 70) → 종료 사유: **의미 보존 하한 위반** → 이전 반복 결과로 롤백
   e. 종료 조건 미충족 시 교정된 텍스트를 입력으로 다음 반복

3. **출력 형식**:

#### Ouroboros 반복 로그

| 반복 | 점수 (전) | 점수 (후) | 개선량 | 종료 사유 |
|------|-----------|-----------|--------|-----------|
| 0    | —         | 78        | —      | 초기 측정 |
| 1    | 78        | 45        | +33    |           |
| 2    | 45        | 28        | +17    | 목표 달성 |

#### 최종 결과
- 최종 점수: 28/100 (±10)
- 반복 횟수: 2/3
- 종료 사유: 목표 달성 (target: 30)

[최종 교정 텍스트]

> **주의:** `--ouroboros`는 rewrite 출력을 기본으로 한다. `--diff`, `--audit`, `--score`와 함께 사용할 수 없다.

---

## 배치 모드 (`--batch`)

`--batch` 플래그가 있으면 아래 절차를 따른다. 1~4단계(설정, 패턴, 프로필, 목소리 로드)는 한 번만 실행한다.

### 입력

```
Glob {지정된 파일 패턴} → 파일 목록 확보
```

파일 크기 제한: 50KB 초과 파일은 건너뛰고 요약에 "skipped (too large)" 표시.

### 처리 흐름

각 파일에 대해 순차적으로:
1. `Read` 파일 내용
2. 5단계(텍스트 처리) 파이프라인 실행
3. `--score` 모드를 자동 적용하여 교정 전/후 점수를 측정
4. 결과 저장:
   - `--in-place`: `Write`로 원본 파일 덮어쓰기
   - `--suffix <ext>`: `Write`로 `{원본명}{ext}` 파일 생성
   - `--outdir <dir>`: `Write`로 `{dir}/{파일명}` 생성
   - 위 옵션이 없으면: 각 파일의 결과를 순차적으로 출력 (기본 output 모드 적용)

한 파일이 실패하면 에러를 기록하고 다음 파일로 계속 진행한다.

### 결과 요약

모든 파일 처리 후 요약 테이블을 출력한다:

| 파일 | 교정 전 점수 | 교정 후 점수 | 교정 패턴 수 | 상태 |
|------|-------------|-------------|-------------|------|
| post1.md | 67 | 23 | 12 | ✅ |
| post2.md | 45 | 18 | 8 | ✅ |
| big.md | — | — | — | ⏭️ skipped (too large) |
| broken.md | — | — | — | ❌ error: parse failed |

> **주의:** `--batch`는 `--ouroboros`와 함께 사용할 수 있다. 이 경우 각 파일에 대해 ouroboros 루프가 독립적으로 실행된다.

---

## 5단계: 텍스트 처리

로드된 패턴, 프로필, 목소리 지침을 조합하여 텍스트를 처리한다. 처리는 3개 하위 단계로 나뉜다.

### 5a단계: 구조 분석 (Phase 1)

`phase: structure` 팩의 패턴만 적용한다. 글 전체의 구조적 문제를 먼저 해결한다.

0. **Suspect zone 활용** — 4.6단계의 hot 단락을 우선 검토 대상으로 표시. meta block 과 `«P{n} SUSPECT»` prefix 를 참고해 단락 단위 분석 우선순위를 결정한다. 4.7단계의 lexicon hit 정보(meta block의 `lexicon_density` 항목과 인용된 AI-lexicon entry)도 추가 우선 신호로 참고한다 — 분포 균질성과 어휘 신호가 함께 떠 있으면 그 단락이 가장 우선이다
1. **문서 구조 스캔** - 단락 배치, 반복 구조, 번역체 구문, 수동태 패턴을 글 전체 수준에서 분석
2. **구조적 문제 교정** - 단락 구조 다양화, 번역체 교정, 이중 피동 제거
3. **의미 보존 확인** - 구조 변경 후에도 핵심 주장과 논리 흐름이 유지되는지 확인
4. **Burstiness 적용** - 단락 길이와 문장 수를 의도적으로 불규칙하게 조절

> **주의:** 텍스트가 2개 단락 이하로 짧으면 구조 분석을 건너뛰고 5b단계로 직행한다.
> **주의:** `phase: structure` frontmatter를 가진 팩이 0개이면 이 단계를 건너뛰고 5b단계로 직행한다.

### 5a-v단계: 앵커 검증 (Anchor Verification)

5a단계 완료 후, 4.5단계에서 추출한 앵커 목록과 5a 출력을 비교한다.

```
FOR each anchor IN anchor_list:
  IF anchor.content이 존재하고 anchor.polarity가 보존됨:
    → PASS
  ELSE IF anchor.content이 존재하지만 약화/모호함:
    → SOFT FAIL
  ELSE IF anchor.content이 삭제되었거나 anchor.polarity가 반전됨:
    → HARD FAIL
```

**SOFT FAIL 기준** (앵커가 존재하지만 약화된 경우):
- 구체적 주장이 모호해진 경우: "매출이 30% 증가" → "매출이 크게 증가"
- 수치가 정밀도를 잃은 경우: "p<0.05" → "통계적으로 유의미함"
- 인과 관계가 상관 관계로 바뀐 경우: "A가 B를 유발" → "A와 B는 연관"
- 단정적 진술이 헤징된 경우: "시스템이 실패했다" → "시스템에 문제가 있었을 수 있다"

**판정별 처리:**

| 판정 | 조건 | 처리 |
|------|------|------|
| **PASS** | 앵커 의미 보존, 극성 유지 | 다음 단계로 진행 |
| **SOFT FAIL** | 앵커 존재하나 약화/모호 | 대안 교정 시도 (재시도 1회) |
| **HARD FAIL** | 앵커 삭제 또는 극성 반전 | 해당 구간 원문으로 복원 |

**재시도 절차 (SOFT FAIL 발생 시):**
1. 실패한 결과가 아닌 **원문 문장**에 동일 패턴을 재적용한다
2. 교정 프롬프트에 제약을 주입한다: "다음 의미를 반드시 보존하라: {앵커 내용}"
3. 재시도 결과를 앵커와 대조한다
4. 재시도도 실패하면 → HARD FAIL로 처리 (원문 복원)
5. 앵커당 최대 1회 재시도 (재시도 루프 없음)

---

### 5b단계: 문장/어휘 패턴 (Phase 2)

나머지 패턴 팩(2단계에서 로드된 팩 중 `phase: structure`가 아닌 모든 팩)을 적용한다.

0. **Suspect zone 활용** — 4.6단계의 hot 문장 그룹(`P{n}.S{m}-S{k}`)을 우선 재작성 대상으로 처리. meta block 의 sub-flag 정보를 사용해 패턴 스캔 우선순위를 결정한다. 4.7단계의 lexicon hit 인용("AI-lexicon hits: ..." 부분) 도 우선 재작성 신호로 사용 — 인용된 AI 어구가 등장하는 문장을 패턴 스캔 우선순위 상단에 둔다
1. **AI 패턴 식별** - 로드된 문장/어휘 패턴 팩의 모든 패턴을 스캔
2. **문제 구간 다시 쓰기** - AI스러운 표현을 토큰 단위로 치환하지 말고, 문맥을 읽은 뒤 절/문장 단위로 자연스럽게 다시 쓴다
3. **의미 보존** - 핵심 메시지를 유지
4. **어조 맞추기** - 프로필의 어조 지침에 따라 톤 조절
5. **개성 불어넣기** - voice.md의 지침에 따라 실제 사람의 목소리를 넣기
6. **blocklist/allowlist 적용** - 설정의 blocklist 어휘도 추가 감지, allowlist 어휘는 감지에서 제외
7. **프로필 오버라이드 적용** - 프로필에 `pattern-overrides`가 있으면 해당 패턴의 교정 강도를 조절 (suppress/reduce/amplify)
8. **톤 파생 오버라이드 적용 (v3.10)** — `resolved_tone != null`이면 프로필 오버라이드 위에 톤별 오버라이드를 추가 적용한다. 충돌 시 톤 오버라이드가 우선한다.

   > **Override stack 규칙 (H5):** 동일 instruction이 두 레이어(profile + tone)에서 발화하면 한 번만 적용한다 (멱등). 톤 오버라이드는 프로필 오버라이드를 **대체(replace)** 하는 것이지 **중첩(stack)** 이 아니다. 즉, 같은 패턴 번호에 대해 profile=`reduce`, tone=`amplify` 가 동시 지정되면 최종은 `amplify` 단일이며 `reduce` × `amplify` 같은 누적 연산은 일어나지 않는다.

   | Tone | ko 오버라이드 | en 오버라이드 |
   |------|-------------|-------------|
   | `casual` | 14:suppress, 15:reduce, 17:reduce, 18:amplify, 8:amplify | 14:suppress, 15:reduce, 17:reduce, 7:amplify, 8:amplify |
   | `professional` | 17:suppress, 25:reduce, 28:amplify | 17:suppress, 25:reduce, 28:amplify |
   | `academic` | 17:suppress, 14:reduce, 8:reduce | 17:suppress, 14:reduce, 8:reduce |
   | `narrative` | 14:suppress, 15:suppress, 25:suppress, 26:reduce, 27:reduce | 14:suppress, 15:suppress, 25:suppress, 26:reduce, 27:reduce |
   | `marketing` | 17:allow, 14:reduce, 28:suppress | 17:allow, 14:reduce, 28:suppress |
   | `instructional` | 25:allow, 15:allow, 22:reduce, 28:suppress, 14:reduce | 25:allow, 15:allow, 22:reduce, 28:suppress, 14:reduce |

   **legal/medical fidelity 강제 (R2):** resolved_tone=professional이고 config.profile이 `legal` 또는 `medical`이면, `ouroboros.combined-weights.legal` / `ouroboros.combined-weights.medical` (fidelity 0.65)을 강제 적용한다. 톤 오버라이드가 fidelity 하한을 낮추지 않도록 한다.

9. **의미 보존 제약 주입** — 의미 위험도가 HIGH인 패턴을 적용할 때, 해당 문단의 앵커를 교정 프롬프트에 포함한다: "다음 주장을 반드시 유지하라: {앵커 목록}". MEDIUM 위험도 패턴은 극성(Polarity) 또는 부정(Negation) 앵커가 있는 문단에서만 제약을 주입한다. LOW 위험도 패턴은 제약 없이 적용한다.

**CJK 절/문장 단위 교정 가드 (issue #352):** `--lang ko|zh|ja`에서는 구두점이나 단어 1개만 1:1로 바꾸지 않는다. em dash, 콜론, 세미콜론, 슬래시, 쉼표 접속, 괄호식 삽입구처럼 절 관계를 표시하는 구두점이 AI 신호와 함께 보이면, 문장 전체를 읽고 목표 언어의 자연스러운 절 구조·문장 분리·접속 표현으로 다시 짠다. 번역체/직역 명사구가 구두점에 붙어 있으면 둘을 함께 고친다. 한국어 예: `무 TUI` 식 직역은 `TUI 없이 완전 자율로 설치하려면 ...`처럼 풀고, `"끝난 것 같아요"로는 부족한 열린 작업`은 `"끝난 것 같아요"만으로는 부족한, 결과를 끝까지 확인해야 하는 열린 작업`처럼 절 관계를 드러낸다. 교정 중 행위자·극성·조건·숫자·인과는 유지한다.

> **주의:** 5a단계에서 이미 교정한 구간을 5b단계에서 다시 "정돈된 공식문"으로 되돌리지 않도록 주의한다.

---

### 5b-v단계: 앵커 검증 (Anchor Verification)

5b단계 완료 후, 앵커 목록과 5b 출력을 비교한다. 검증 로직은 5a-v단계와 동일하다.

**회귀 체크**: 5a단계에서 교정된 구간이 5b단계에서 되돌려지지 않았는지, 5a 출력과 5b 출력을 해당 구간에 대해 비교한다. 되돌려진 구간이 있으면 5a 교정을 재적용한다.

---

### 5c단계: 자기검수 (Phase 3)

1. **AI 검수** — "아래 글에서 AI가 쓴 것처럼 보이는 부분은?" 질문 후 짧게 답한다
2. **최종 앵커 대조** — 전체 앵커 목록과 최종 결과물을 비교한다. 5a-v/5b-v에서 미처리된 HARD FAIL 앵커가 있으면 해당 문장을 원문으로 복원한다 (안전망)
3. **극성 반전 스캔** — 원문의 부정이 긍정으로(또는 반대) 바뀐 곳을 명시적으로 탐색한다. 부정어, 비교 표현, 조건절에 집중한다
4. **회귀 체크** — 5a단계 출력과 최종 출력을 비교하여, 5a 교정이 되돌려진 구간이 있으면 5a 교정을 재적용한다
5. **MPS 산출** — 앵커 검증 결과로부터 MPS(Meaning Preservation Score)를 계산한다. `--score` 또는 `--ouroboros` 모드일 때 출력에 포함한다

---

## 6단계: 출력

**모든 출력 모드 공통 — YAML footer (v3.10):**

모든 출력 모드(rewrite, diff, audit, score)의 최종 결과 끝에 다음 YAML footer 블록을 추가한다. 이것이 tone 정보의 **유일한** 노출 지점이다. rewrite 본문에 `[tone: ...]` 같은 인라인 표기를 절대 포함하지 않는다 (A7).

```
---
tone: <resolved_tone | null>
tone_source: user | auto | unsupported_language_fallback | profile_only | skipped_short_input
tone_evidence: ["<신호 1>", "<신호 2>"]
tone_confidence: low | medium | high
---
```

- `tone_source: profile_only`: `--tone` 미사용 + config `tone:` 미설정 (profile-only 모드)
- `tone_source: user`: 명시적 `--tone` 또는 config `tone:` 으로 지정
- `tone_source: auto`: `--tone auto` 또는 `tone: auto` 로 자동 감지 수행 (잔류 규칙으로 떨어진 경우 포함)
- `tone_source: unsupported_language_fallback`: zh/ja에서 명시 톤 사용 시
- `tone_source: skipped_short_input`: 단락<2 OR 문장<2 이라 4.5b 감지를 시작 안 한 경우 (auto 요청이었지만 검출 자체가 실행되지 않음)

### rewrite 모드 (기본)

다음을 제공한다:
1. 초안
2. "아래 글에서 AI가 쓴 것처럼 보이는 부분은?" (간단한 목록)
3. 최종본
4. 변경 사항 요약 (필요시)
5. YAML footer (위 공통 규칙 적용)

> **주의 (A7):** rewrite 최종본 본문에 tone 정보를 언급하거나 삽입하지 않는다. "이 텍스트는 casual 톤으로 재작성되었습니다" 같은 내러티브 인터젝션 금지.

### diff 모드 (`--diff`)

변경 사항을 패턴별로 표시한다. 뭘 왜 바꿨는지 보여준다. 끝에 YAML footer 추가.

### audit 모드 (`--audit`)

감지만 하고 수정하지 않는다. 패턴별 발견 위치와 심각도를 테이블로 출력한다. 끝에 YAML footer 추가.

### score 모드 (`--score`)

AI 유사도 점수를 0-100 척도로 산출한다. `core/scoring.md`를 참조하여 아래 절차를 따른다.

1. **패턴 감지**: audit 모드와 동일하게 모든 패턴을 스캔하고, 감지된 각 패턴에 대해
   severity를 부여한다 (`core/scoring.md`의 심각도 루브릭 참조)
2. **프로필 오버라이드 적용**: pattern-overrides가 있으면 심각도를 조정한다
   - `amplify`: 심각도 × 1.5 (최대 3)
   - `reduce`: 심각도 × 0.5
   - `suppress`: 심각도 = 0 (해당 패턴 건너뜀)
3. **카테고리 점수 계산**: 각 카테고리별로 (카테고리는 팩 frontmatter의 `pack` 필드에서
   언어 접두사를 제거하여 도출: `ko-content` → `content`)
   - 카테고리 점수 = (조정된 심각도 합계 / (패턴 수 × 3)) × 100
   - 패턴 수는 팩 frontmatter의 `patterns` 필드를 사용한다
4. **전체 점수 계산**: 카테고리 점수의 가중 평균
   - 가중치는 `ouroboros.category-weights.{lang}` 설정을 사용한다
   - 설정에 없는 카테고리(커스텀 팩)는 기본 가중치 0.10을 사용한다
5. **출력 형식**:

| 카테고리 | 가중치 | 감지 패턴 | 원점수 | 가중 점수 |
|----------|--------|-----------|--------|-----------|
| content  | 0.18   | 3/6       | 33.3   | 6.0       |
| language | 0.18   | 1/8       | 8.3    | 1.5       |
| style    | 0.18   | 2/6       | 27.8   | 5.0       |
| communication | 0.13 | 0/4    | 0.0    | 0.0       |
| filler   | 0.08   | 1/4       | 8.3    | 0.7       |
| structure | 0.15  | 1/5       | 20.0   | 3.0       |
| viral-hook | 0.10 | 0/9       | 0.0    | 0.0       |
| **전체** |        |           |        | **16.2 (±10)** |
| **tone** | —      | —         | casual | auto/high  |

> **참고:** 카테고리 점수는 소수점으로 계산하고, 표시는 소수 첫째 자리까지 반올림한다. tone 행은 resolved_tone과 tone_source/tone_confidence를 표시한다. 끝에 공통 YAML footer를 추가한다.

점수 해석: 0-15 사람다움 / 16-30 거의 사람다움 / 31-50 혼재 / 51-70 AI 느낌 / 71-100 AI 생성

### Fidelity 점수 (rewrite/ouroboros 모드에서만)

`--score`가 rewrite 또는 ouroboros 모드와 함께 사용되면 (원본 텍스트가 있는 경우), 원본 대비 의미 보존도를 추가로 측정한다. `core/scoring.md` §§ 9-13의 절차를 따른다:

1. **Claims Preserved** — 원본의 사실적 주장이 교정본에 보존되었는지 (0-3)
2. **No Fabrication** — 교정본에 원본에 없는 내용이 추가되지 않았는지 (0-3)
3. **Tone Match** — 문체/격식 수준이 일치하는지 (0-3, 프로필 오버라이드 고려)
4. **Length Ratio** — 길이 비율이 적절한지 (0-3, 결정론적 계산)

| 지표 | 점수 |
|------|------|
| AI 유사도 | 23/100 (낮을수록 좋음) |
| 충실도 | 87/100 (높을수록 좋음) |
| 의미 보존 (MPS) | 92/100 (높을수록 좋음) |
| 종합 | 25/100 (낮을수록 좋음) |

의미 보존 점수(MPS)는 4.5단계에서 추출된 의미 앵커가 최종 결과물에 얼마나 보존되었는지를 측정한다. `core/scoring.md` §14를 참조한다.

종합 점수 = `(AI 유사도 × ai_weight) + ((100 - 충실도) × fidelity_weight)`.
가중치는 `ouroboros.combined-weights.{profile}` 설정에 따른다 (기본: AI 0.60, 충실도 0.40).

> **참고:** 점수는 LLM의 심각도 판단에 기반하므로 ±8-10 포인트의 변동이 있을 수 있다.
> 정확한 수치보다 범위로 해석한다.

---

## 전체 예시

**수정 전 (AI스러운 글):**
> 좋은 질문이십니다! 이 주제에 대해 정리해 드리겠습니다. 도움이 되셨으면 좋겠습니다!
>
> AI 코딩 도구는 대규모 언어 모델의 혁신적인 잠재력을 보여주는 핵심적인 이정표로서, 소프트웨어 개발의 진화에 있어 획기적인 전환점을 의미한다. 오늘날 급변하는 기술 환경에서 이러한 선도적인 도구들은 연구와 실무의 교차점에 자리하며, 엔지니어들의 작업 방식을 근본적으로 재편하고 있다.
>
> 이를 통해 달성되는 핵심적인 가치는 명확하다: 프로세스의 효율화, 협업의 강화, 그리고 조직 정렬의 촉진. 이것은 단순한 자동완성에 그치지 않고, 대규모 창의성 발현을 가능하게 하는 것이다. 이 도구는 촉매제 역할을 하고 있다. 이 어시스턴트는 파트너로서 기능하고 있다. 이 시스템은 혁신의 토대를 마련하고 있다.
>
> 업계 관계자들은 도입이 개인 실험 단계에서 전사적 배포 단계로, 1인 개발자에서 다기능 팀으로 빠르게 확대되고 있다고 주목하고 있다. 이 기술은 뉴욕타임스, 와이어드, 더버지 등에서 크게 보도되었다. 아울러, 문서화, 테스트, 리팩토링을 생성할 수 있는 능력은 AI가 효과적인 성과 도출에 기여할 수 있음을 보여주며, 자동화와 인간 판단 간의 심층적인 상호작용을 부각하고 있다.
>
> - 💡 **속도:** 코드 생성이 획기적으로 빨라지며, 개발자 역량을 극대화하고 있습니다.
> - 🚀 **품질:** 개선된 학습을 통해 출력 품질이 효과적으로 향상되고 있습니다.
> - ✅ **도입:** 사용량이 지속적으로 증가하며, 업계 전반의 트렌드를 반영하고 있습니다.
>
> 구체적인 정보는 제한적이나, 이러한 도구들이 어느 정도의 긍정적 효과를 가져올 수 있을 것으로 판단될 수도 있다. 이러한 과제에도 불구하고 생태계는 계속 성장하고 있다. 이 잠재력을 극대화하기 위해서는 체계적인 모범 사례를 수립해야 한다.
>
> 결론적으로, 앞으로 밝은 미래가 기대된다. 탁월함을 향한 흥미진진한 여정이 우리 앞에 펼쳐져 있다. 더 자세한 내용이 필요하시면 말씀해 주세요!

**초안:**
> AI 코딩 도구는 지루한 작업을 빠르게 처리해 준다. 아키텍처 설계까지는 아니지만.
>
> 설정 파일, 테스트 뼈대, 반복적인 리팩토링 같은 보일러플레이트에 강하다. 문제는 틀린 코드도 자신 있게 보인다는 것이다. 컴파일도 되고 린트도 통과하는 코드를 무심코 수락했다가, 나중에 의도와 다른 동작을 하는 걸 발견한 적이 있다.
>
> 주변 사람들 반응은 대체로 두 부류다. 잡무에 자동완성처럼 쓰면서 한 줄 한 줄 확인하는 사람. 원하지 않는 패턴을 자꾸 제안해서 꺼버린 사람. 둘 다 합리적이다.
>
> 생산성 지표는 애매하다. GitHub은 코파일럿 사용자가 "제안의 30%를 수락한다"고 하는데, 수락이 정확성은 아니고, 정확성이 가치는 아니다. 테스트가 없으면 결국 감으로 판단하는 것이다.

**"아래 글에서 AI가 쓴 것처럼 보이는 부분은?"**
- 리듬이 아직 좀 깔끔하게 정돈되어 있다 (깔끔한 대조, 고른 문단 길이).
- 마지막 문장이 약간 슬로건처럼 들린다.
- 전체적으로 "정리된 블로그 글" 느낌이 남아 있다.

**"이제 AI가 쓴 것처럼 보이지 않게 고쳐라"**
> AI 코딩 도구, 잡일은 빨라진다. 설정 파일이나 테스트 뼈대 같은 거.
>
> 근데 맞는 것처럼 보이는 게 문제다. 컴파일되고 린트 통과하길래 넘겼는데 나중에 보니 완전 엉뚱한 동작을 하고 있었다. 내가 확인을 안 한 게 문제지만, 확인 안 하게 만드는 것도 이 도구의 특성이다.
>
> 쓰는 사람들은 두 부류인 것 같다. 잡무에만 쓰면서 한 줄씩 보는 사람이랑, 짜증나서 꺼버린 사람. 나는 왔다 갔다 한다.
>
> 생산성이 올라갔냐고 물으면 솔직히 모르겠다. "제안 30% 수락"이 뭘 의미하는지도 모르겠고. 테스트가 없으면 맞는지 틀린지 감으로 때리는 거니까.

**변경 사항:**
- 챗봇 표현 제거 ("좋은 질문이십니다!", "도움이 되셨으면", "말씀해 주세요")
- 과도한 중요성 부여 제거 ("핵심적인 이정표", "획기적인 전환점", "혁신적인 잠재력")
- 홍보성 언어 제거 ("선도적인", "탁월함을 향한")
- 모호한 출처 제거 ("업계 관계자들은")
- ~하며/~하고 피상적 분석 제거 ("기여하며", "부각하고", "반영하고")
- 부정 병렬구조 제거 ("그치지 않고... 것이다")
- 3의 법칙 제거 ("효율화, 강화, 촉진", "촉매제/파트너/토대")
- AI 특유 어휘 제거 ("아울러", "심층적인", "체계적인")
- ~적 접미사 축소 ("혁신적인", "효과적으로", "획기적으로")
- ~고 있다 진행형 축소 ("재편하고 있다", "성장하고 있다")
- 이모지, 볼드체, 인라인 헤더 제거
- 과도한 연결 표현 제거 ("이를 통해", "아울러")
- 학습 데이터 면책 제거 ("구체적인 정보는 제한적이나")
- 과도한 헤징 제거 ("~일 수도 있다")
- 채움 표현 제거 ("~하기 위해서는")
- 막연한 긍정적 결론 제거 ("밝은 미래가 기대된다", "흥미진진한 여정")
- 개성과 목소리를 추가 (리듬 변화, 1인칭, 솔직한 감정)

---

## 참고

이 스킬은 [위키백과:AI 글쓰기의 징후](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)를 기반으로 하며, WikiProject AI Cleanup이 관리합니다. 해당 문서의 패턴은 위키백과에서 발견된 수천 건의 AI 생성 텍스트 관찰에서 비롯되었습니다. 한국어 버전은 원본의 보편적 패턴에 더해, 한국어 AI 글쓰기에서 나타나는 고유한 패턴(~적 접미사, ~고 있다 진행형, 과도한 한자어 등)을 추가로 반영합니다.

핵심 통찰: "LLM은 통계적 알고리즘으로 다음에 올 것을 예측한다. 결과는 가장 넓은 범위에 적용 가능한, 가장 통계적으로 가능성 높은 결과로 수렴하는 경향이 있다."

> **영어 처리 참고:** `--lang en` 사용 시 동일한 파이프라인을 따른다. 영어 `en-structure.md` 팩에는 4개의 구조 패턴(#25 Metronomic Paragraph Structure, #26 Passive Nominalization Chains, #27 Zombie Nouns, #28 Stacked Subordinate Clauses)이 포함되어 있으므로 5a단계(구조 분석)가 한국어와 마찬가지로 실행된다.
