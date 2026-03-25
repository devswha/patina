한국어 | **[English](README.md)**

# patina

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code Skill](https://img.shields.io/badge/Claude%20Code-Skill-blueviolet)](https://docs.anthropic.com/en/docs/claude-code)
[![Based on](https://img.shields.io/badge/Based%20on-blader%2Fhumanizer-blue)](https://github.com/blader/humanizer)
[![Multi-language](https://img.shields.io/badge/Languages-Korean%20%7C%20English-green)](https://github.com/devswha/patina)

**AI가 쓴 글을 사람이 쓴 것처럼 바꿔줍니다.**

한국어와 영어 텍스트에서 AI 글쓰기 패턴을 탐지하고 제거하는 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 스킬입니다. "혁신적인 이정표", "~에 그치지 않고", "밝은 미래가 기대된다" 같은 AI 특유의 표현을 찾아 자연스러운 문장으로 고쳐줍니다.

> "LLM은 통계적 알고리즘으로 다음에 올 것을 예측한다. 결과는 가장 넓은 범위에 적용 가능한, 가장 통계적으로 가능성 높은 결과로 수렴하는 경향이 있다." — [위키백과](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)

## 이렇게 바뀝니다

**수정 전** (AI스러운 글):
> AI 코딩 도구는 대규모 언어 모델의 **혁신적인 잠재력**을 보여주는 **핵심적인 이정표**로서, 소프트웨어 개발의 진화에 있어 **획기적인 전환점**을 의미한다. 이를 통해 달성되는 핵심적인 가치는 명확하다: 프로세스의 효율화, 협업의 강화, 그리고 조직 정렬의 촉진.

**수정 후** (사람다운 글):
> AI 코딩 도구, 잡일은 빨라진다. 설정 파일이나 테스트 뼈대 같은 거. 근데 맞는 것처럼 보이는 게 문제다. 컴파일되고 린트 통과하길래 넘겼는데 나중에 보니 완전 엉뚱한 동작을 하고 있었다.

한국어 28개 + 영어 24개, 총 52개 패턴을 탐지합니다. [전체 패턴 목록](#패턴)은 아래에서 확인하세요.

## 설치

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/devswha/patina.git ~/.claude/skills/patina

# MAX 변형을 별도 Claude 스킬로 노출
ln -snf ~/.claude/skills/patina/patina-max ~/.claude/skills/patina-max
```

Claude Code는 `/patina`를 자동 인식합니다. `/patina-max`까지 쓰려면 symlink 단계도 함께 실행하세요.

## 사용법

Claude Code에서 입력:

```
/patina

[여기에 텍스트를 붙여넣으세요]
```

기본 언어는 한국어입니다. 영어 텍스트를 처리하려면:

```
/patina --lang en

[paste your English text here]
```

### 옵션

| 플래그 | 기능 |
|--------|------|
| `--lang en` | 영어 텍스트 처리 |
| `--profile blog` | 블로그/에세이 문체 사용 |
| `--diff` | 패턴별 변경 사항 표시 |
| `--audit` | AI 패턴만 탐지 (수정 안 함) |
| `--score` | AI 유사도 점수 0-100 |
| `--ouroboros` | 반복 자기개선: AI 점수가 수렴할 때까지 교정 반복 |

플래그 조합 가능: `/patina --lang en --audit --profile blog`

### MAX 모드 (멀티모델)

같은 텍스트를 여러 AI 모델에 동시에 돌려 가장 좋은 결과를 선택합니다:

```
/patina-max

[여기에 텍스트를 붙여넣으세요]
```

각 모델이 독립적으로 휴머나이징하고, AI 유사도를 점수로 평가한 뒤, 가장 낮은 점수(가장 사람다운) 결과가 최종 출력됩니다.

| 플래그 | 기능 |
|--------|------|
| `--models claude,gemini` | 사용할 모델 선택 |
| `--lang en` | 영어 텍스트 처리 |
| `--profile blog` | 블로그/에세이 문체 사용 |

지원 모델: `claude`, `codex`, `gemini`. MAX 모드는 세 모델 모두 stdin으로 프롬프트를 전달하며 (`claude -p`, `gemini -p '' --output-format text`, `codex exec --skip-git-repo-check`), Codex 최종 응답은 `--output-last-message`로 별도 캡처합니다.

각 MAX 실행은 고유한 임시 디렉터리를 사용하고, 선택한 모델만 기다리며, 타임아웃 난 모델은 무한 대기 대신 `failed`로 처리합니다.

### 점수 모드

텍스트가 얼마나 AI스러운지 수정 없이 확인:

```
/patina --score

[여기에 텍스트를 붙여넣으세요]
```

카테고리별 분석과 함께 0-100 AI 유사도 점수를 반환합니다:

```
| 카테고리       | 가중치 | 감지 패턴 | 원점수 | 가중 점수 |
|---------------|--------|-----------|--------|-----------|
| content       | 0.20   | 3/6       | 33.3   | 6.7       |
| language      | 0.20   | 1/6       | 11.1   | 2.2       |
| style         | 0.20   | 2/6       | 27.8   | 5.6       |
| communication | 0.15   | 0/3       | 0.0    | 0.0       |
| filler        | 0.10   | 1/3       | 11.1   | 1.1       |
| structure     | 0.15   | 1/4       | 25.0   | 3.8       |
| 전체           |        |           |        | 19.3 (±10) |

해석: 16-30 = 거의 사람다움, 약간의 AI 흔적
```

점수 범위: **0-15** 사람다움 | **16-30** 거의 사람다움 | **31-50** 혼재 | **51-70** AI 느낌 | **71-100** AI 생성

점수는 패턴 기반으로 산출됩니다 — audit 모드와 동일한 28개(한국어) 또는 24개(영어) 탐지 패턴을 재사용합니다. 프로필 오버라이드가 점수에 영향을 미칩니다 (예: blog 프로필은 볼드체 패턴 #14를 무시).

### 우로보로스 모드 (반복 자기개선)

AI 점수가 목표치 이하로 떨어질 때까지 자동으로 반복 교정:

```
/patina --ouroboros

[여기에 텍스트를 붙여넣으세요]
```

우로보로스 루프는 전체 교정 파이프라인을 반복 실행하며, 매 반복 후 점수를 측정합니다:

```
Ouroboros 반복 로그

| 반복 | 점수 (전) | 점수 (후) | 개선량 | 종료 사유    |
|------|-----------|-----------|--------|-------------|
| 0    | —         | 78        | —      | 초기 측정    |
| 1    | 78        | 45        | +33    |             |
| 2    | 45        | 28        | +17    | 목표 달성    |

최종 점수: 28/100 (±10)
반복 횟수: 2/3
종료 사유: 목표 달성 (target: 30)

[최종 교정 텍스트]
```

**종료 조건** (하나라도 충족 시 종료):
- **목표 달성**: 점수가 30 이하로 내려감 (설정 가능)
- **개선 정체**: 반복 간 점수 개선이 10포인트 미만
- **점수 회귀**: 점수가 오히려 올라감 (텍스트가 악화) — 이전 반복 결과로 롤백
- **반복 상한**: 최대 3회 반복 (설정 가능)

**설정** — `.patina.yaml`에서 커스터마이징:

```yaml
ouroboros:
  target-score: 30          # 이 점수 이하면 종료 (0-100)
  max-iterations: 3         # 최대 반복 횟수
  plateau-threshold: 10     # 최소 개선 요구량
```

`--ouroboros`는 `--diff`, `--audit`, `--score`와 함께 사용할 수 없습니다.

## 동작 원리

```
입력 텍스트
  |
  v
[1단계] 구조 분석 -- 단락 수준 문제 교정 (반복 구조, 수동태)
  |
  v
[2단계] 문장 다시쓰기 -- 어휘 수준 문제 교정 (AI 어휘, 채움말, 헤징)
  |
  v
[3단계] 자기검수 -- "아직 AI처럼 보이는 부분이 있나?" -- 남은 문제 수정
  |
  v
자연스러운 텍스트
```

언어별 패턴 팩(`ko-*.md` 또는 `en-*.md`)을 로드하여 3단계 파이프라인으로 처리합니다. 프로필과 목소리 지침이 톤을 조절합니다.

## <a name="패턴"></a>패턴

### 한국어 (28개 패턴)

<details>
<summary><b>구조 패턴</b> (Phase 1) -- 문서 수준 문제 4개</summary>

| # | 패턴 | AI가 하는 것 | 수정 방법 |
|---|------|-------------|----------|
| 25 | 구조적 반복 | 모든 단락이 "주장→근거→의의" 동일 구조 | 구조 다양화: 질문, 디테일, 짧은 펀치 |
| 26 | 번역체 | "~것은 사실이다", "~하는 것이 가능하다" | 자연스러운 한국어 문형 |
| 27 | 수동태 남용 | "~되어지다", "~되어질 수 있다" | 능동태 또는 단순 수동 |
| 28 | 불필요한 외래어 | "인사이트를 레버리지하여 시너지를" | 고유어 대체 |

</details>

<details>
<summary><b>콘텐츠 패턴</b> -- 내용 문제 6개</summary>

| # | 패턴 | AI가 하는 것 | 수정 방법 |
|---|------|-------------|----------|
| 1 | 과도한 중요성 부여 | "획기적인 전환점", "핵심적인 이정표" | 구체적 사실, 날짜, 수치로 교체 |
| 2 | 과도한 주목도/미디어 언급 | "뉴욕타임스, BBC 등에서 주목" | 특정 기사 하나 인용 |
| 3 | ~하며/~하고 피상적 분석 | "보여주며, 상징하고, 기여하며" | 근거 없으면 삭제 |
| 4 | 홍보성/광고성 언어 | "수려한 자연경관... 관광의 보석" | 사실 기반 중립 서술 |
| 5 | 모호한 출처 인용 | "전문가들은... 업계 관계자에 따르면" | 구체적 출처 명시 |
| 6 | 틀에 박힌 "과제와 전망" | "과제에도 불구하고... 밝은 미래" | 구체적 문제점과 계획 |

</details>

<details>
<summary><b>언어 패턴</b> -- 문법/어휘 문제 6개</summary>

| # | 패턴 | AI가 하는 것 | 수정 방법 |
|---|------|-------------|----------|
| 7 | AI 특유 어휘 남발 | "아울러, 다양한 혁신적인... 이를 통해" | 쉬운 말, 구체적 내용 |
| 8 | ~적(的) 접미사 남발 | "혁신적이고 체계적인... 효과적이고" | 실제 일어난 일 서술 |
| 9 | 부정 병렬구조 | "~에 그치지 않고", "~뿐만 아니라" | 요점 직접 서술 |
| 10 | 3의 법칙 남발 | "창의성, 혁신성, 그리고 지속가능성" | 자연스러운 개수 사용 |
| 11 | 유의어 순환 | "이 도시... 이 지역... 해당 지자체" | 하나 골라서 쓰기 |
| 12 | 장황한 조사 사용 | "~에 있어서", "~함에 있어" | "~에서", "~하려면" |

</details>

<details>
<summary><b>스타일 패턴</b> -- 서식 문제 6개</summary>

| # | 패턴 | AI가 하는 것 | 수정 방법 |
|---|------|-------------|----------|
| 13 | 과도한 연결 표현 | "이를 통해... 이러한 점에서... 한편" | 불필요한 연결어 삭제 |
| 14 | 볼드체 남발 | "**OKR**, **KPI**, **BSC**" | 일반 텍스트 |
| 15 | 인라인 헤더 목록 | "**성능:** 성능이 향상되었습니다" | 산문으로 변환 |
| 16 | ~고 있다 진행형 남발 | "개척하고 있으며, 추진하고 있고" | 과거형 또는 구체적 계획 |
| 17 | 이모지 | 전문 텍스트에 이모지 섹션 마커 | 삭제 |
| 18 | 과도한 한자어/공식어 | "복리 증진을 도모하기 위한" | "생활을 개선하려는" |

</details>

<details>
<summary><b>커뮤니케이션 패턴</b> -- 챗봇 흔적 3개</summary>

| # | 패턴 | AI가 하는 것 | 수정 방법 |
|---|------|-------------|----------|
| 19 | 챗봇 표현 | "도움이 되셨으면! 말씀해 주세요" | 전부 삭제 |
| 20 | 학습 데이터 기한 면책 | "구체적인 정보는 제한적이나" | 출처 찾거나 삭제 |
| 21 | 아첨하는 말투 | "좋은 질문이십니다! 정확하게 짚어주셨는데요" | 바로 답하기 |

</details>

<details>
<summary><b>채움/헤징 패턴</b> -- 군더더기 3개</summary>

| # | 패턴 | AI가 하는 것 | 수정 방법 |
|---|------|-------------|----------|
| 22 | 채움 표현 | "~하기 위해서는", "~라는 사실에 기인하여" | "~하려면", "~때문에" |
| 23 | 과도한 헤징 | "~일 수 있을 것으로 판단될 수도" | "~일 수 있다" |
| 24 | 막연한 긍정적 결론 | "밝은 미래가 기대된다" | 구체적 계획이나 사실 |

</details>

### 영어 (24개 패턴)

[blader/humanizer](https://github.com/blader/humanizer)에서 포팅, [위키백과: AI 글쓰기의 징후](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) 기반.

<details>
<summary><b>콘텐츠 패턴</b> -- 6개</summary>

| # | 패턴 | AI가 하는 것 | 수정 방법 |
|---|------|-------------|----------|
| 1 | 중요성 부풀리기 | "represents a significant milestone" | 구체적 사실 |
| 2 | 미디어/주목도 부풀리기 | "garnered significant attention" | 특정 출처 인용 |
| 3 | 피상적 -ing 분석 | "showcasing, highlighting, underscoring" | 삭제하거나 출처 추가 |
| 4 | 홍보성 언어 | "stunning, world-class, hidden gem" | 중립 서술 |
| 5 | 모호한 출처 | "experts say, studies show" | 출처 명시 |
| 6 | 과제와 전망 공식 | "despite challenges... poised for growth" | 구체적 문제/계획 |

</details>

<details>
<summary><b>언어 패턴</b> -- 6개</summary>

| # | 패턴 | AI가 하는 것 | 수정 방법 |
|---|------|-------------|----------|
| 7 | AI 어휘 | "delve, tapestry, landscape, multifaceted" | 쉬운 말 |
| 8 | 계사 회피 | "serves as, acts as, functions as" | "is" 사용 |
| 9 | 부정 병렬 | "not just X but Y" | 요점 직접 서술 |
| 10 | 3의 법칙 | "X, Y, and Z" 반복 | 자연스러운 개수 |
| 11 | 유의어 순환 | "the city... the metropolis... the urban center" | 하나 골라 쓰기 |
| 12 | 거짓 범위 | "from X to Y", "ranging from... to" | 구체적 수치 |

</details>

<details>
<summary><b>스타일 패턴</b> -- 6개</summary>

| # | 패턴 | AI가 하는 것 | 수정 방법 |
|---|------|-------------|----------|
| 13 | em 대시 남용 | "innovation — a key driver — transforms" | em 대시 줄이기 |
| 14 | 볼드체 남용 | 모든 핵심 용어를 볼드 | 일반 텍스트 |
| 15 | 인라인 헤더 목록 | "**Label:** description" 형식 | 산문으로 변환 |
| 16 | 제목 대문자 | "The Future Of Artificial Intelligence" | 문장형 대소문자 |
| 17 | 이모지 | 이모지 섹션 마커 | 삭제 |
| 18 | 둥근 따옴표 | 일반 텍스트에 스마트 따옴표 | 직선 따옴표 |

</details>

<details>
<summary><b>커뮤니케이션 패턴</b> -- 3개</summary>

| # | 패턴 | AI가 하는 것 | 수정 방법 |
|---|------|-------------|----------|
| 19 | 챗봇 표현 | "I hope this helps! Let me know" | 전부 삭제 |
| 20 | 학습 데이터 면책 | "as of my last update" | 출처 찾거나 삭제 |
| 21 | 아첨하는 말투 | "Great question!" | 바로 답하기 |

</details>

<details>
<summary><b>채움/헤징 패턴</b> -- 3개</summary>

| # | 패턴 | AI가 하는 것 | 수정 방법 |
|---|------|-------------|----------|
| 22 | 채움 표현 | "it's important to note that" | 군더더기 삭제 |
| 23 | 과도한 헤징 | "could potentially be argued that perhaps" | 직접 서술 |
| 24 | 막연한 긍정적 결론 | "a bright future lies ahead" | 구체적 사실 |

</details>

<details>
<summary><b>한국어 vs 영어: 패턴이 다른 부분</b></summary>

일부 패턴은 언어에 따라 다릅니다. 같은 번호에서 한국어와 영어가 다른 패턴을 사용합니다:

| # | 한국어 | 영어 |
|---|--------|------|
| 8 | ~적 접미사 남발 (한자어 형용사) | 계사 회피 ("serves as") |
| 12 | 장황한 조사 (한국어 문법) | 거짓 범위 ("from X to Y") |
| 13 | 과도한 연결 표현 (한국어 접속사) | em 대시 남용 |
| 16 | ~고 있다 진행형 남발 | 제목 대문자 (Title Case) |
| 18 | 과도한 한자어/공식어 | 둥근 따옴표 |
| 25-28 | 구조 패턴 (한국어 전용) | 플레이스홀더 (영어 해당 없음) |

</details>

## 설정

`.patina.default.yaml` 수정:

```yaml
version: "3.2.0"
language: ko              # ko | en (또는 --lang 플래그 사용)
profile: default          # default | blog
output: rewrite           # rewrite | diff | audit | score
skip-patterns: []         # 예: [ko-filler] 특정 팩 건너뛰기
blocklist: []             # 추가로 감지할 어휘
allowlist: []             # 감지에서 제외할 어휘
max-models:             # MAX 모드 모델 (claude, codex, gemini)
  - claude
  - gemini
dispatch: omc             # omc | direct
```

패턴 팩은 언어 접두사로 자동 탐색됩니다 — 수동 등록 불필요.

## 프로필

| 프로필 | 톤 | 용도 |
|--------|-----|------|
| `default` | 원래 톤 유지 | 범용 |
| `blog` | 개인적, 의견 강조 | 블로그, 에세이 |

```
/patina --profile blog 텍스트...
```

## 커스텀 패턴

`custom/patterns/`에 `.md` 파일을 넣으면 자동으로 로드됩니다:

```markdown
---
pack: my-patterns
language: ko
name: 내 커스텀 패턴
version: 1.0.0
patterns: 1
---

### 1. 패턴 이름
**문제:** AI가 뭘 잘못하는지
**수정 전:** > AI스러운 예시
**수정 후:** > 자연스러운 수정
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
├── .patina.default.yaml      # 설정
├── core/voice.md             # 문체/개성 가이드라인
├── core/scoring.md           # 스코어링 알고리즘 레퍼런스
├── patterns/
│   ├── ko-*.md               # 한국어 패턴 (6팩, 28개)
│   └── en-*.md               # 영어 패턴 (6팩, 24개)
├── profiles/                 # 글쓰기 스타일 프로필
├── examples/                 # 수정 전/후 테스트 케이스
└── custom/                   # 사용자 확장 (gitignore됨)
```

[oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh)의 플러그인 구조에서 영감: 패턴은 플러그인, 프로필은 테마.

## 새 언어 추가

1. `patterns/{lang}-content.md`, `{lang}-language.md` 등을 생성
2. 각 파일 frontmatter에 `language: {lang}` 설정
3. `/patina --lang {lang}`으로 사용 — 자동 탐색, 설정 변경 불필요

## 참고 자료

- [위키백과: AI 글쓰기의 징후](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) — 패턴의 원천
- [WikiProject AI Cleanup](https://en.wikipedia.org/wiki/Wikipedia:WikiProject_AI_Cleanup) — 커뮤니티 활동
- [blader/humanizer](https://github.com/blader/humanizer) — 영어 원본

## 버전 히스토리

| 버전 | 변경 사항 |
|------|----------|
| **3.2.0** | 우로보로스 스코어링 시스템: 패턴 기반 AI 유사도 점수(0-100), `--score` 모드(카테고리별 분석), `--ouroboros` 반복 자기개선 루프(목표달성/정체/회귀/상한 종료 조건) |
| **3.1.1** | MAX 모드 안정성 수정: 실행별 temp dir, 선택 모델만 기다리는 wait loop + timeout 처리, Gemini stdin 디스패치, Codex CLI 호환성 수정(`--output-last-message`, `-q` 제거) |
| **3.1.0** | 설치 가능한 `/patina-max` 진입점 + provider-aware 디스패치 (`claude -p` / `gemini -p` for Claude/Gemini, `codex exec` for Codex) |
| **3.0.0** | 다국어 프레임워크, `--lang` 플래그, 영어 패턴 (24개) blader/humanizer에서 포팅, 스킬명 `patina`로 변경 |
| **2.2.0** | 불필요한 외래어 패턴 (#28), 배지, 레포 이름 변경 |
| **2.1.0** | 2-Phase 파이프라인, 구조 패턴, 블로그 프로필, 예시 |
| **2.0.0** | 플러그인 구조: 패턴 팩, 프로필, 설정 파일 |
| **1.0.0** | 한국어 최초 적용 (24개 패턴) |

## 라이선스

MIT
