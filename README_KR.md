한국어 | **[English](README.md)** | **[中文](README_ZH.md)** | **[日本語](README_JA.md)**

# patina

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code Skill](https://img.shields.io/badge/Claude%20Code-Skill-blueviolet)](https://docs.anthropic.com/en/docs/claude-code)
[![Based on](https://img.shields.io/badge/Based%20on-blader%2Fhumanizer-blue)](https://github.com/blader/humanizer)
[![Multi-language](https://img.shields.io/badge/Languages-Korean%20%7C%20English%20%7C%20Chinese%20%7C%20Japanese-green)](https://github.com/devswha/patina)

**AI가 쓴 글을 사람이 쓴 것처럼 바꿔줍니다.**

한국어, 영어, 중국어, 일본어 텍스트에서 AI 특유의 글쓰기 패턴을 탐지하고 제거하는 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 스킬입니다. "혁신적인 패러다임", 세 항목 나열, 모호한 결론 같은 전형적인 AI 흔적을 찾아내 자연스러운 문장으로 다시 씁니다.

> "LLM은 통계 알고리즘으로 다음에 올 내용을 예측합니다. 결과는 가장 많은 경우에 들어맞는, 가장 통계적으로 그럴듯한 방향으로 수렴하게 됩니다." — [Wikipedia](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)

## 실제 적용 예시

**적용 전** (AI 냄새가 나는 글):
> AI 코딩 도구는 대규모 언어 모델의 **혁신적 잠재력**을 보여주는 **획기적인 이정표**로, 소프트웨어 개발 진화의 **결정적 전환점**을 의미합니다. 이는 프로세스를 간소화할 뿐만 아니라 협업을 촉진하고 조직 정렬을 가능하게 합니다.

**적용 후** (같은 뜻, 자연스러운 표현):
> AI 코딩 도구는 지루한 작업을 확실히 줄여줍니다. 설정 파일 생성, 보일러플레이트 테스트, CRUD 엔드포인트 채우기 같은 것들이요. 백로그에 허덕이는 팀에겐 이 정도 시간 절약이 꽤 큽니다. 협업 효과는 수치로 잡기 어렵지만, 저희 팀은 도입 후 PR 회전 시간이 3일에서 1일 정도로 줄었습니다.

한국어(29개), 영어(29개), 중국어(29개), 일본어(29개) 총 116개 패턴을 탐지합니다. [전체 패턴 목록](#patterns)은 아래에서 확인하세요.

## 설치

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/devswha/patina.git ~/.claude/skills/patina

# MAX 모드를 별도 스킬로 노출
ln -snf ~/.claude/skills/patina/patina-max ~/.claude/skills/patina-max
```

Claude Code가 `/patina`를 자동으로 인식합니다. `/patina-max`도 별도 스킬로 사용하려면 심볼릭 링크 단계도 함께 실행하세요.

### 빠른 설치

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

스킬 디렉토리 생성, 저장소 클론, patina-max 심볼릭 링크 설정까지 한 번에 처리합니다. 업데이트할 때 다시 실행해도 안전합니다.

## 사용법

Claude Code에서 다음과 같이 입력하세요:

```
/patina

[텍스트를 여기에 붙여넣기]
```

기본 언어는 한국어입니다. 다른 언어를 처리하려면:

```
/patina --lang en

[영어 텍스트를 여기에 붙여넣기]
```

```
/patina --lang zh

[중국어 텍스트를 여기에 붙여넣기]
```

```
/patina --lang ja

[일본어 텍스트를 여기에 붙여넣기]
```

### 추가 옵션

| 플래그 | 기능 |
|------|-------------|
| `--lang en` | 영어 텍스트 처리 |
| `--lang zh` | 중국어 텍스트 처리 |
| `--lang ja` | 일본어 텍스트 처리 |
| `--batch docs/*.md` | 여러 파일을 한 번에 처리 |
| `--in-place` | 원본 파일을 덮어쓰기 (`--batch`와 함께 사용) |
| `--suffix .humanized` | `{file}.humanized.md`로 저장 |
| `--outdir output/` | 결과를 지정 디렉토리에 저장 |
| `--profile blog` | 블로그/에세이 문체 사용 |
| `--profile formal` | 공식 문서 문체 사용 (이력서, 제안서 등) |
| `--diff` | 변경 사항과 이유를 패턴별로 표시 |
| `--audit` | AI 패턴 탐지만 수행 (재작성 없음) |
| `--score` | AI 유사도 점수를 0-100으로 표시 |
| `--ouroboros` | 반복 자기개선: AI 점수가 수렴할 때까지 재작성 |

플래그를 자유롭게 조합할 수 있습니다: `/patina --lang en --audit --profile blog` 또는 `/patina --profile formal`

### MAX 모드 (멀티 모델)

같은 텍스트를 여러 AI 모델에 돌려서 가장 좋은 결과를 선택합니다:

```
/patina-max

[텍스트를 여기에 붙여넣기]
```

각 모델이 독립적으로 텍스트를 사람답게 고치고, AI 유사도와 의미 보존(MPS)을 함께 평가한 뒤, MPS 하한(≥ 70)을 통과한 후보 중 AI 점수가 가장 낮은 결과가 선택됩니다.

| 플래그 | 기능 |
|------|-------------|
| `--models claude,gemini` | 사용할 모델 선택 |
| `--lang en` | 영어 텍스트 처리 |
| `--profile blog` | 블로그/에세이 문체 사용 |

지원 모델: `claude`, `codex`, `gemini`. MAX 모드는 세 모델 모두에 stdin으로 전달하며(`claude -p`, `gemini -p '' --output-format text`, `codex exec --skip-git-repo-check`), Codex의 최종 답변은 `--output-last-message`로 캡처합니다.

각 MAX 실행은 고유한 임시 디렉토리를 사용하고, 선택한 모델만 대기하며, 타임아웃된 실행은 무한 대기 대신 실패로 처리합니다.

### 스코어 모드

재작성 없이 텍스트가 얼마나 AI스러운지 확인합니다:

```
/patina --score

[텍스트를 여기에 붙여넣기]
```

0-100 AI 유사도 점수와 카테고리별 상세 내역을 반환합니다:

```
| Category      | Weight | Detected | Raw Score | Weighted |
|---------------|--------|----------|-----------|----------|
| content       | 0.20   | 3/6      | 33.3      | 6.7      |
| language      | 0.20   | 1/6      | 11.1      | 2.2      |
| style         | 0.20   | 2/6      | 27.8      | 5.6      |
| communication | 0.15   | 0/3      | 0.0       | 0.0      |
| filler        | 0.10   | 1/3      | 11.1      | 1.1      |
| structure     | 0.15   | 1/4      | 25.0      | 3.8      |
| Overall       |        |          |           | 19.3 (±10) |

Interpretation: 16-30 = Mostly human-like, minor traces
```

점수 범위: **0-15** 사람 | **16-30** 대체로 사람다움 | **31-50** 혼재 | **51-70** AI스러움 | **71-100** 심하게 AI스러움

재작성 또는 우로보로스 모드와 함께 사용할 경우, **충실도 점수**(0-100, 높을수록 좋음)도 함께 표시됩니다. 이는 출력이 원문의 의미를 얼마나 잘 보존했는지를 측정합니다:

```
| 지표              | 점수    |
|-------------------|---------|
| AI 유사도         | 23/100  |
| 충실도            | 87/100  |
| 의미 보존 (MPS)   | 92/100  |
| 종합              | 19/100  |
```

충실도는 네 가지 기준을 확인합니다: 주장 보존, 허위 내용 없음, 톤 일치, 길이 비율. 의미 보존 점수(MPS)는 핵심 주장, 극성, 인과관계, 수치 등 의미 앵커가 교정 과정에서 얼마나 보존되었는지를 측정한다. 종합 점수는 AI 유사도와 충실도를 가중 합산하며, 프로필별로 설정할 수 있습니다(예: 학술: 충실도 0.60, AI 0.40 / 블로그: AI 0.70, 충실도 0.30).

점수는 패턴 기반의 결정적 방식으로 계산됩니다. 감사(audit) 모드와 동일한 29개(한국어), 29개(영어), 29개(중국어), 29개(일본어) 탐지 패턴을 재사용합니다. 프로필 오버라이드는 점수에 영향을 줍니다(예: 블로그 프로필은 볼드 패턴 #14를 억제).

### 우로보로스 모드 (반복 자기개선)

AI 점수가 목표 아래로 내려갈 때까지 자동으로 재작성합니다:

```
/patina --ouroboros

[텍스트를 여기에 붙여넣기]
```

우로보로스 루프는 전체 사람화 파이프라인을 반복 실행하며, 매 반복 후 점수를 매깁니다:

```
Ouroboros Iteration Log

| Iter | Before | After | Improvement | Reason      |
|------|--------|-------|-------------|-------------|
| 0    | —      | 78    | —           | Initial     |
| 1    | 78     | 45    | +33         |             |
| 2    | 45     | 28    | +17         | Target met  |

Final score: 28/100 (±10)
Iterations: 2/3
Reason: Target met (target: 30)

[최종 사람화된 텍스트]
```

**종료 조건** (먼저 충족되는 조건 적용):
- **목표 달성**: 점수가 30 이하로 떨어짐 (설정 가능)
- **정체**: 반복 간 개선 폭이 10포인트 미만
- **퇴행**: 점수가 올라감 (글이 나빠짐) -- 이전 반복 결과로 롤백
- **최대 반복 횟수**: 3회 하드캡 (설정 가능)
- **충실도 하한**: 충실도가 70 이하로 떨어지면 이전 반복으로 롤백
- **의미 보존 하한**: MPS가 70 이하로 떨어지면 이전 반복으로 롤백

**설정** -- `.patina.yaml`에서 커스터마이징:

```yaml
ouroboros:
  target-score: 30          # 점수가 이 값 이하면 중단 (0-100)
  max-iterations: 3         # 최대 반복 횟수
  plateau-threshold: 10     # 최소 개선 폭 요구치
  fidelity-floor: 70        # 충실도가 이 값 이하면 중단
  mps-floor: 70             # 의미 보존 점수가 이 값 이하면 중단
```

`--ouroboros`는 `--diff`, `--audit`, `--score`와 함께 사용할 수 없습니다.

## 동작 원리

```
입력 텍스트
  |
  v
[4.5단계] 의미 앵커 추출 -- 핵심 주장, 극성, 인과관계, 수치 추출
  |
  v
[Phase 1] 구조 분석 -- 단락 수준 문제 교정 (반복, 수동태)
  |
  v
[5a-v단계] 앵커 검증 -- Phase 1 후 의미 보존 확인
  |
  v
[Phase 2] 문장 교정 -- 어휘 수준 문제 교정 (AI 어휘, 채움 표현, 헤징)
  |
  v
[5b-v단계] 앵커 검증 -- Phase 2 후 의미 보존 확인
  |
  v
[Phase 3] 자기검수 -- 극성 스캔, 회귀 체크, 최종 MPS 산출
  |
  v
자연스러운 텍스트 (의미 검증 완료)
```

스킬은 언어별 패턴 팩(`ko-*.md`, `en-*.md`, `zh-*.md`, `ja-*.md`)을 불러와 이 파이프라인에 적용합니다. 의미 앵커(핵심 주장, 극성, 수치)는 교정 전에 추출되고 각 단계 후에 검증됩니다 -- 의미가 손상된 경우 해당 변경을 재시도하거나 롤백합니다. 프로필과 보이스 가이드라인이 톤을 결정합니다.

## <a name="patterns"></a>패턴

### 한국어 (29개 패턴)

<details>
<summary><b>구조 패턴</b> (Phase 1) -- 문서 수준 문제 4개 패턴</summary>

| # | 패턴 | AI가 하는 것 | 교정 방법 |
|---|---------|-------------|-----|
| 25 | 구조적 반복 | 모든 문단이 주장-근거-의의 구조를 따름 | 질문, 세부묘사, 짧은 강조 등으로 구조 변화 |
| 26 | 번역투 | 영어 직역체("~라는 것은 사실이다") | 자연스러운 한국어 문장 형태 사용 |
| 27 | 수동태 남용 | 이중 수동 구문 | 능동태 또는 단순 수동태 |
| 28 | 불필요한 외래어 | "레버리지 인사이트로 시너지를" | 고유어 대체어 사용 |
| 29 | 거짓 뉘앙스 | "사실 좀 더 미묘한 문제인데요" | 새 근거 제시 또는 삭제 |

</details>

<details>
<summary><b>내용 패턴</b> -- 실질적 문제 6개 패턴</summary>

| # | 패턴 | AI가 하는 것 | 교정 방법 |
|---|---------|-------------|-----|
| 1 | 중요성 과장 | "획기적인 이정표", "결정적 전환점" | 구체적 사실, 날짜, 숫자로 대체 |
| 2 | 미디어 언급 과장 | "NYT, BBC 등에 보도" | 구체적인 기사 하나를 인용 |
| 3 | 피상적 -ing 분석 | "보여주며, 상징하며, 기여하며" | 군더더기 삭제 또는 실제 출처 추가 |
| 4 | 홍보성 표현 | "놀라운 자연 경관... 관광의 보석" | 사실에 기반한 중립적 묘사 |
| 5 | 모호한 출처 | "전문가들은... 업계 관계자는" | 실제 출처를 밝힘 |
| 6 | 공식적 도전/전망 | "도전에도 불구하고... 밝은 미래" | 구체적 문제와 실행 계획 |

</details>

<details>
<summary><b>언어 패턴</b> -- 문법/어휘 문제 6개 패턴</summary>

| # | 패턴 | AI가 하는 것 | 교정 방법 |
|---|---------|-------------|-----|
| 7 | AI 어휘 남용 | 한국어 AI 충전어 과다 사용 | 평이한 표현, 구체적 내용 |
| 8 | -적 접미사 남용 | 한자어 형용사 접미사 누적 | 실제 일어난 일을 묘사 |
| 9 | 부정 병렬구문 | "X뿐만 아니라 Y도"를 남발 | 요점을 직접 진술 |
| 10 | 세 항목 규칙 | 어디서나 세 항목 나열 | 자연스러운 개수 사용 |
| 11 | 유의어 순환 | 같은 대상에 유의어를 돌려 씀 | 하나를 골라 일관되게 사용 |
| 12 | 장황한 조사 | 불필요하게 긴 문법 형태 | 간결한 대체 표현 |

</details>

<details>
<summary><b>문체 패턴</b> -- 서식 문제 6개 패턴</summary>

| # | 패턴 | AI가 하는 것 | 교정 방법 |
|---|---------|-------------|-----|
| 13 | 접속어 남용 | 한국어 전환어 과다 사용 | 불필요한 접속어 제거 |
| 14 | 볼드 남용 | 핵심 용어마다 볼드 처리 | 일반 텍스트 유지 |
| 15 | 인라인 헤더 목록 | "**레이블:** 설명" 형식 | 산문으로 전환 |
| 16 | 진행형 남용 | 한국어 진행형 과다 사용 | 과거형 또는 구체적 계획 |
| 17 | 이모지 | 전문 텍스트에 이모지 섹션 구분 | 삭제 |
| 18 | 과도한 격식체 | 지나치게 공식적인 어투 | 평이한 표현 |

</details>

<details>
<summary><b>소통 패턴</b> -- 챗봇 흔적 4개 패턴</summary>

| # | 패턴 | AI가 하는 것 | 교정 방법 |
|---|---------|-------------|-----|
| 19 | 챗봇 표현 | "도움이 되셨길 바랍니다! 궁금한 점은" | 완전 삭제 |
| 20 | 학습 시점 고지 | "구체적 정보는 제한적입니다" | 출처를 찾거나 삭제 |
| 21 | 아부하는 어투 | "좋은 질문입니다! 정확합니다" | 바로 답변 |
| 29 | 거짓 뉘앙스 | "사실 좀 더 미묘한 문제인데요" | 새 근거 제시 또는 삭제 |

</details>

<details>
<summary><b>군더더기 & 헤징 패턴</b> -- 채우기용 표현 3개 패턴</summary>

| # | 패턴 | AI가 하는 것 | 교정 방법 |
|---|---------|-------------|-----|
| 22 | 군더더기 표현 | 불필요한 채우기 단어 | 간결한 대체 표현 |
| 23 | 과도한 헤징 | 지나치게 조건을 다는 진술 | 직접적 진술 |
| 24 | 모호한 긍정 결론 | "밝은 미래가 기다리고 있다" | 구체적 계획 또는 사실 |

</details>

### 영어 (29개 패턴)

[blader/humanizer](https://github.com/blader/humanizer)에서 이식, [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) 기반.

<details>
<summary><b>내용 패턴</b> -- 6개 패턴</summary>

| # | 패턴 | AI가 하는 것 | 교정 방법 |
|---|---------|-------------|-----|
| 1 | 중요성 과장 | "represents a significant milestone" | 구체적 사실 |
| 2 | 미디어/유명도 과장 | "garnered significant attention" | 구체적 출처 인용 |
| 3 | 피상적 -ing 분석 | "showcasing, highlighting, underscoring" | 삭제 또는 출처 추가 |
| 4 | 홍보성 표현 | "stunning, world-class, hidden gem" | 중립적 묘사 |
| 5 | 모호한 출처 | "experts say, studies show" | 출처 명시 |
| 6 | 도전과 전망 | "despite challenges... poised for growth" | 구체적 문제/계획 |

</details>

<details>
<summary><b>언어 패턴</b> -- 6개 패턴</summary>

| # | 패턴 | AI가 하는 것 | 교정 방법 |
|---|---------|-------------|-----|
| 7 | AI 어휘 | "delve, tapestry, landscape, multifaceted" | 평이한 표현 |
| 8 | 계사 회피 | "serves as, acts as, functions as" | 그냥 "is" 사용 |
| 9 | 부정 병렬구문 | "not just X but Y" | 요점을 직접 진술 |
| 10 | 세 항목 규칙 | "X, Y, and Z" 반복 | 자연스러운 항목 수 |
| 11 | 유의어 순환 | "the city... the metropolis... the urban center" | 하나를 선택 |
| 12 | 거짓 범위 | "from X to Y", "ranging from... to" | 구체적 수치 |

</details>

<details>
<summary><b>문체 패턴</b> -- 6개 패턴</summary>

| # | 패턴 | AI가 하는 것 | 교정 방법 |
|---|---------|-------------|-----|
| 13 | 엠 대시 남용 | "innovation -- a key driver -- transforms" | 엠 대시 줄이기 |
| 14 | 볼드 남용 | 곳곳에 볼드 처리된 용어 | 일반 텍스트 |
| 15 | 인라인 헤더 목록 | "**Label:** description" 형식 | 산문으로 전환 |
| 16 | 제목 대문자 | "The Future Of Artificial Intelligence" | 문장식 대문자 |
| 17 | 이모지 | 이모지 섹션 구분 | 삭제 |
| 18 | 둥근 따옴표 | 일반 텍스트에 스마트 따옴표 사용 | 직선 따옴표 |

</details>

<details>
<summary><b>소통 패턴</b> -- 4개 패턴</summary>

| # | 패턴 | AI가 하는 것 | 교정 방법 |
|---|---------|-------------|-----|
| 19 | 챗봇 표현 | "I hope this helps! Let me know" | 완전 삭제 |
| 20 | 학습 시점 고지 | "as of my last update" | 출처를 찾거나 삭제 |
| 21 | 아부하는 어투 | "Great question!" | 바로 답변 |
| 29 | 거짓 뉘앙스 | "Actually, it's more nuanced..." | 새 근거 제시 또는 삭제 |

</details>

<details>
<summary><b>군더더기 & 헤징 패턴</b> -- 3개 패턴</summary>

| # | 패턴 | AI가 하는 것 | 교정 방법 |
|---|---------|-------------|-----|
| 22 | 군더더기 표현 | "it's important to note that" | 군더더기 삭제 |
| 23 | 과도한 헤징 | "could potentially be argued that perhaps" | 직접적 진술 |
| 24 | 모호한 긍정 결론 | "a bright future lies ahead" | 구체적 사실 |

</details>

<details>
<summary><b>중국어 패턴 (zh)</b> -- 28개 패턴</summary>

중국어 패턴은 동일한 6개 카테고리 구조를 따릅니다. `--lang zh`는 모든 `zh-*.md` 팩을 자동 탐색합니다.

**내용 (6):** 부당한 중요성 강조, 미디어/유명도 주장, 피상적 동사열 분석, 홍보성 표현, 모호한 출처, 공식적 도전-전망 구문.

**언어 (6):** AI 유행어 남용 (赋能/助力/深耕), 사자성어 남용 (成语堆砌), 과도하게 정규화된 的/地/得, 배비구 남용 (排比句), 유의어 순환, 장황한 전치사 구문.

**문체 (6):** 접속어 남용, 볼드 남용, 인라인 헤더 목록, 地-부사 남용, 이모지, 관료적 공문체 (公文体).

**소통 (4):** 챗봇 흔적, 학습 시점 고지, 아부하는 어투, 거짓 뉘앙스.

**군더더기 (3):** 군더더기 표현 (众所周知/不可否认的是), 과도한 헤징, 일반적 긍정 결론.

**구조 (4):** 구조적 반복, 번역투/유럽식 문법, 被 수동태 남용, 총분총(总分总) 구조 남용.

</details>

<details>
<summary><b>일본어 패턴 (ja)</b> -- 28개 패턴</summary>

일본어 패턴은 동일한 6개 카테고리 구조를 따릅니다. `--lang ja`는 모든 `ja-*.md` 팩을 자동 탐색합니다.

**내용 (6):** 부당한 중요성 강조, 미디어/유명도 주장, 피상적 동사열 분석 (〜しており), 홍보성 표현, 모호한 출처, 공식적 도전-전망 구문.

**언어 (6):** AI 유행어 남용, 〜的(teki) 접미사 남용, 부정 병렬구문, 세 항목 규칙, 유의어 순환, 가타카나 외래어 남용.

**문체 (6):** 접속어 남용, 볼드 남용, 인라인 헤더 목록, 과도한 경어 (ございます/させていただきます), 이모지, 딱딱한 である체 어투.

**소통 (4):** 챗봇 흔적, 학습 시점 고지, 아부하는 어투, 거짓 뉘앙스.

**군더더기 (3):** 군더더기 표현 (周知の通り/言うまでもなく), 과도한 헤징, 일반적 긍정 결론.

**구조 (4):** 구조적 반복, 번역투, 〜ている 진행형 남용, 기승전결(起承転結) 공식 남용.

</details>

<details>
<summary><b>한국어 vs 영어 vs 중국어 vs 일본어: 패턴이 다른 부분</b></summary>

일부 패턴은 언어에 따라 다릅니다. 한 언어에 있는 패턴이 다른 언어에서는 같은 자리에 다른 패턴이 들어갑니다:

| # | 한국어 | 영어 | 중국어 | 일본어 |
|---|--------|---------|---------|----------|
| 8 | -적 접미사 남용 | 계사 회피 ("serves as") | 사자성어 남용 (成语) | -teki 접미사 남용 (〜的) |
| 9 | 부정 병렬구문 | 부정 병렬구문 | 的/地/得 과잉 정규화 | 부정 병렬구문 |
| 10 | 세 항목 규칙 | 세 항목 규칙 | 배비구 남용 (排比句) | 세 항목 규칙 |
| 12 | 장황한 조사 | 거짓 범위 ("from X to Y") | 장황한 전치사 구문 (在～的基础上) | 가타카나 외래어 남용 |
| 13 | 접속어 남용 | 엠 대시 남용 | 접속어 남용 (与此同时/此外) | 접속어 남용 |
| 16 | 진행형 남용 | 제목 대문자 | 地-부사 남용 (积极地/深入地) | 과도한 경어 (ございます) |
| 18 | 과도한 격식체 | 둥근 따옴표 | 관료적 공문체 (公文体) | 딱딱한 である체 어투 |
| 25 | 구조적 반복 | 메트로놈식 문단 구조 | 구조적 반복 | 구조적 반복 |
| 26 | 번역투 | 수동 명사화 연쇄 | 번역투/유럽식 문법 | 번역투 |
| 27 | 수동태 남용 | 좀비 명사 | 被 남용 | ている 진행형 남용 |
| 28 | 불필요한 외래어 | 중첩 종속절 | 总分总 구조 남용 | 기승전결 공식 남용 |
| 29 | 거짓 뉘앙스 | False Nuance | 虚假细化 | 偽りのニュアンス |

</details>

## 설정

`.patina.default.yaml`을 편집하세요:

```yaml
version: "3.2.0"
language: ko              # ko | en | zh | ja (또는 --lang 플래그 사용)
profile: default
output: rewrite           # rewrite | diff | audit | score
skip-patterns: []         # 예: [ko-filler]로 특정 팩 건너뛰기
blocklist: []             # 추가로 탐지할 단어
allowlist: []             # 절대 탐지하지 않을 단어
max-models:             # MAX 모드 모델 (claude, codex, gemini)
  - claude
  - gemini
dispatch: omc             # omc | direct
```

패턴 팩은 언어 접두사로 자동 탐색됩니다 -- 수동으로 목록에 추가할 필요가 없습니다.

## 프로필

| 프로필 | 톤 | 용도 |
|---------|------|----------|
| `default` | 원문 톤 유지 | 범용 |
| `blog` | 개인적이고 주관적 | 블로그 글, 에세이 |
| `academic` | 격식체, 근거 기반 | 연구 논문, 학위 논문 |
| `technical` | 명확하고 정밀, 의견 배제 | API 문서, README, 가이드 |
| `social` | 캐주얼, 짧게, 이모지 허용 | 트위터/X, 인스타그램, 스레드 |
| `email` | 정중하되 간결 | 비즈니스 이메일, 공식 서한 |
| `legal` | 법률 관행 보존 | 계약서, 법률 의견서 |
| `medical` | 의학적 정밀도 보존 | 임상 보고서, 의학 논문 |
| `marketing` | 설득력 있고 구체적 | 광고 카피, 제품 페이지, 보도자료 |
| `formal` | 전문적이고 간결 | 이력서, 자기소개서, 제안서 |

```
/patina --profile blog text...
/patina --profile academic text...
/patina --profile technical text...
/patina --profile formal text...
```

## 커스텀 패턴

`custom/patterns/`에 `.md` 파일을 넣으면 자동으로 로드됩니다:

```markdown
---
pack: my-patterns
language: ko
name: My Custom Patterns
version: 1.0.0
patterns: 1
---

### 1. Pattern Name
**Problem:** What AI does wrong
**Before:** > AI-sounding example
**After:** > Natural-sounding fix
```

## 프로젝트 구조

```
patina/
├── SKILL.md                  # /patina 진입점
├── SKILL-MAX.md              # MAX 모드 소스/참고 문서
├── patina-max/               # 설치 가능한 /patina-max 스킬 디렉토리
│   ├── SKILL.md              # MAX 모드 진입점
│   ├── core -> ../core
│   ├── patterns -> ../patterns
│   └── profiles -> ../profiles
├── .patina.default.yaml      # 설정 파일
├── core/voice.md             # 보이스 & 개성 가이드라인
├── core/scoring.md           # 스코어링 알고리즘 참고 (AI 유사도 + 충실도 + MPS)
├── patterns/
│   ├── ko-*.md               # 한국어 패턴 (6개 팩, 29개 패턴)
│   ├── en-*.md               # 영어 패턴 (6개 팩, 29개 패턴)
│   ├── zh-*.md               # 중국어 패턴 (6개 팩, 29개 패턴)
│   └── ja-*.md               # 일본어 패턴 (6개 팩, 29개 패턴)
├── profiles/                 # 글쓰기 스타일 프로필
├── examples/                 # 적용 전/후 테스트 케이스
└── custom/                   # 사용자 확장 (gitignore 대상)
```

[oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh)의 플러그인 아키텍처에서 영감: 패턴은 플러그인, 프로필은 테마에 해당합니다.

## 새 언어 추가하기

1. `patterns/{lang}-content.md`, `{lang}-language.md` 등을 생성합니다
2. 각 파일의 프론트매터에 `language: {lang}`을 설정합니다
3. `/patina --lang {lang}`으로 사용 -- 자동 탐색되므로 설정 변경이 필요 없습니다

## 참고 자료

- [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) -- 패턴의 주요 출처
- [WikiProject AI Cleanup](https://en.wikipedia.org/wiki/Wikipedia:WikiProject_AI_Cleanup) -- 커뮤니티 활동
- [blader/humanizer](https://github.com/blader/humanizer) -- 영어 원본 버전

## 기여하기

[CONTRIBUTING.md](CONTRIBUTING.md)에서 패턴 추가, 예시 개선, 프로필 생성, 오래된 패턴 신고 방법을 확인할 수 있습니다.

**패턴 노화:** AI 글쓰기 패턴은 모델이 파인튜닝되면서 바뀝니다. 더 이상 신뢰할 수 없는 패턴이나 새로운 AI 특징을 발견하면 [이슈를 열어주세요](https://github.com/devswha/patina/issues).

## 버전 이력

| 버전 | 변경 사항 |
|---------|---------|
| **3.2.0** | 우로보로스 스코어링 시스템: 패턴 기반 AI 유사도 점수(0-100), 카테고리별 상세 내역의 `--score` 모드, 설정 가능한 종료 조건(목표/정체/퇴행/최대 반복)의 `--ouroboros` 반복 자기개선 루프 |
| **3.1.1** | MAX 모드 안정성 개선: 실행별 임시 디렉토리, 모델별 대기 루프 + 타임아웃 처리, Gemini stdin 전달, Codex CLI 호환성 (`--output-last-message`, `-q` 제거) |
| **3.1.0** | MAX 모드: 설치 가능한 `/patina-max` 스킬 진입점 + 프로바이더 인식 전달 (Claude/Gemini는 `claude -p` / `gemini -p`, Codex는 `codex exec`) |
| **3.0.0** | 다국어 프레임워크, `--lang` 플래그, blader/humanizer 기반 영어 패턴(24개), 스킬 이름을 `patina`로 변경 |
| **2.2.0** | 외래어 남용 패턴(#28), 배지, 저장소 이름 변경 |
| **2.1.0** | 2-Phase 파이프라인, 구조 패턴, 블로그 프로필, 예제 |
| **2.0.0** | 플러그인 아키텍처: 패턴 팩, 프로필, 설정 |
| **1.0.0** | 한국어 초기 적용 (24개 패턴) |

## 라이선스

MIT
