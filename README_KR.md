한국어 | **[English](README.md)** | **[中文](README_ZH.md)** | **[日本語](README_JA.md)**

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code Skill](https://img.shields.io/badge/Claude%20Code-Skill-blueviolet)](https://docs.anthropic.com/en/docs/claude-code)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-3.8.0-blue)](#버전-이력)

> **AI가 쓴 글을 사람이 쓴 것처럼 바꿔줍니다.**

한국어, 영어, 중국어, 일본어 텍스트에서 AI 특유의 글쓰기 패턴을 탐지하고 교정하는 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 스킬 + 독립형 CLI. 패턴 기반, 감사 가능, 결정적 스코어링 — 블랙박스 LLM 패러프레이저가 아닙니다.

## 데모

**수정 전** (AI스러운 글):
> 커피는 전 세계 사회적 상호작용을 **근본적으로 변화시킨** **핵심적인 문화 현상**으로 부상했습니다. 이 사랑받는 음료는 커뮤니티 구축의 촉매제 역할을 하며, 의미 있는 연결을 촉진하고, 문화 간 대화를 이끌어냅니다. 파리의 활기찬 카페에서 도쿄의 고요한 찻집에 이르기까지, 이 **놀라운 여정**은 인류 음식 문화 탐험의 **혁신적인 정신**을 보여줍니다.

**수정 후** (`/patina --lang ko` — 같은 내용, AI 포장만 제거):
> 커피는 사람들이 만나는 방식을 꽤 많이 바꿔놓았다. 누군가와 마주 앉아 이야기하다 보면 자연스럽게 관계가 생기고, 문화가 다른 사람끼리도 대화가 이어진다. 파리 카페든, 원래 말차를 팔던 도쿄 찻집이든 벌어지는 일은 비슷하다. 콩 하나 볶은 것에서 전 세계가 공유하는 사교 문화가 만들어진 셈이다.

> **MPS = 100** · 전 세계 사회적 변화 ✓ · 커뮤니티 구축 ✓ · 의미 있는 연결 ✓ · 문화 간 대화 ✓ · 파리 카페 ✓ · 도쿄 찻집 ✓ · 음식 문화 탐험 ✓

---

## 한눈에 보기

|  |  |
|---|---|
| **126개 패턴** | 한국어 32 + 영어 31 + 중국어 31 + 일본어 32 |
| **AI 탐지율** | 한국어 91% / 영어 76% (HC3) |
| **오탐율** | NamuWiki 13% / HC3 human 19% / Wikipedia 25% *(백과사전체 한계 — 명시)* |
| **모드** | rewrite · audit · score · diff · ouroboros |
| **무료 사용** | `codex` CLI 로그인 시 API 키 불필요 |
| **라이선스** | MIT |

---

## 목차

- [빠른 시작](#빠른-시작)
- [모드와 플래그](#모드와-플래그)
- [MAX 모드](#max-모드-멀티-모델)
- [스코어 & 우로보로스](#스코어--우로보로스)
- [인증](#인증)
- [동작 원리](#동작-원리)
- [캘리브레이션](#캘리브레이션)
- [패턴](#패턴)
- [설정](#설정)
- [프로필](#프로필)
- [커스텀 패턴](#커스텀-패턴)
- [프로젝트 구조](#프로젝트-구조)
- [새 언어 추가](#새-언어-추가)
- [참고 자료](#참고-자료)
- [버전 이력](#버전-이력)

---

## 빠른 시작

### Claude Code 스킬로 사용

한 줄 설치:

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

Claude Code 에서:

```
/patina --lang ko

[텍스트를 여기에 붙여넣기]
```

[수동 설치 →](#수동-설치)

### 독립형 CLI 로 사용

**Node.js ≥ 18** 필요.

```bash
git clone https://github.com/devswha/patina.git
cd patina && npm install && npm link
patina --lang ko input.txt
```

```bash
# 자주 쓰는 사용 예
patina --lang en --profile blog input.txt
patina --lang ko --score input.txt
patina --lang en --ouroboros input.txt
patina --batch docs/*.md --suffix .humanized
```

> 🆓 **API 키 없이 무료 사용 가능** — [`codex`](https://github.com/openai/codex) CLI 로그인만 되어 있으면 됩니다. 전체 백엔드는 [인증](#인증) 참조.

#### 수동 설치

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/devswha/patina.git ~/.claude/skills/patina
ln -snf ~/.claude/skills/patina/patina-max ~/.claude/skills/patina-max  # MAX 모드 스킬
```

위 독립형 CLI 경로로 이미 클론했다면 다시 클론하지 말고 해당 디렉토리에서 `npm link` 만 실행하세요.

---

## 모드와 플래그

```
patina --lang <ko|en|zh|ja> [모드] [--profile <이름>] [배치 옵션] input.txt
```

| 플래그 | 기능 |
|--------|------|
| `--lang <ko\|en\|zh\|ja>` | 언어 선택 (기본값: `ko`) |
| `--profile <이름>` | 톤 프리셋 — [프로필](#프로필) 참조 |
| `--audit` | AI 패턴 탐지만 수행 (재작성 없음) |
| `--score` | 0–100 AI 유사도 점수 + 카테고리별 분석 |
| `--diff` | 변경 사항을 패턴별로 표시 |
| `--ouroboros` | 점수가 수렴할 때까지 반복 (MPS 롤백 포함) |
| `--batch <glob>` | 여러 파일 일괄 처리 |
| `--in-place` | 원본 파일 덮어쓰기 (`--batch` 와 함께) |
| `--suffix <확장자>` | `{file}.{확장자}.md` 로 저장 |
| `--outdir <dir>` | 결과를 지정 디렉토리에 저장 |
| `--models <목록>` | MAX 모드 — 아래 참조 |

자유롭게 조합 가능: `patina --lang en --audit --profile blog`. 전체 옵션은 `patina --help`.

---

## MAX 모드 (멀티 모델)

같은 텍스트를 Claude, Codex, Gemini 에 독립적으로 돌립니다. 각 모델이 사람화하고, AI 유사도와 MPS 로 점수를 매긴 뒤, MPS ≥ 70 을 통과한 결과 중 AI 점수가 가장 낮은 (가장 사람다운) 결과가 선택됩니다.

```
/patina-max

[텍스트를 여기에 붙여넣기]
```

| 모델 | 디스패치 | 인증 |
|------|----------|------|
| `claude` | `claude -p` | Claude Code |
| `codex` | `codex exec --skip-git-repo-check --output-last-message` | ChatGPT OAuth |
| `gemini` | `gemini -p '' --output-format text` | Google AI Studio |

각 MAX 실행은 격리된 임시 디렉토리를 사용하고, 선택된 모델만 대기하며, 타임아웃은 무한 대기 대신 실패 처리됩니다.

> 독립형 CLI MAX: `patina --models gpt-4o,gpt-4o-mini input.txt` — 같은 `--base-url` 엔드포인트로 호출. 여러 프로바이더를 섞으려면 OpenRouter 같은 멀티 프로바이더 게이트웨이로 `--base-url` 을 가리키세요. Claude Code `/patina-max` 스킬은 로컬 CLI 경유로 디스패치 — API 키 불필요.

---

## 스코어 & 우로보로스

### 스코어 모드

재작성 없이 AI 정도만 확인:

```bash
patina --score input.txt
```

```
| Category      | Weight | Detected | Raw  | Weighted |
|---------------|--------|----------|------|----------|
| content       | 0.20   | 3/6      | 33.3 | 6.7      |
| language      | 0.20   | 1/6      | 11.1 | 2.2      |
| style         | 0.20   | 2/6      | 27.8 | 5.6      |
| communication | 0.15   | 0/3      | 0.0  | 0.0      |
| filler        | 0.10   | 1/3      | 11.1 | 1.1      |
| structure     | 0.15   | 1/4      | 25.0 | 3.8      |
| Overall       |        |          |      | 19.3 (±10) |
```

| 범위 | 해석 |
|------|------|
| 0–15 | 사람 |
| 16–30 | 대체로 사람다움 |
| 31–50 | 혼재 |
| 51–70 | AI스러움 |
| 71–100 | 심하게 AI스러움 |

재작성 모드와 함께 사용 시 추가 지표:

| 지표 | 점수 | 의미 |
|------|------|------|
| AI 유사도 | 23/100 | 낮을수록 사람다움 |
| 충실도 | 87/100 | 주장 보존, 허위 없음, 톤 일치, 길이 비율 |
| MPS | 92/100 | 의미 앵커 (주장, 극성, 인과관계, 수치) |
| 종합 | 19/100 | 프로필 가중치 (예: 블로그 AI 0.70 / 충실도 0.30) |

### 우로보로스 모드

점수가 수렴할 때까지 재작성 반복:

```bash
patina --ouroboros input.txt
```

```
| Iter | Before | After | Improvement | Reason     |
|------|--------|-------|-------------|------------|
| 0    | —      | 78    | —           | Initial    |
| 1    | 78     | 45    | +33         |            |
| 2    | 45     | 28    | +17         | Target met |
```

종료 조건 (먼저 충족되는 것):
- 목표 달성 (점수 ≤ 30, 설정 가능)
- 정체 (반복 간 개선 < 10)
- 퇴행 (점수 상승 — 롤백)
- 최대 반복 횟수 (기본 3회)
- 충실도 / MPS 하한 도달 (롤백)

`.patina.yaml` 에서 설정:

```yaml
ouroboros:
  target-score: 30
  max-iterations: 3
  plateau-threshold: 10
  fidelity-floor: 70
  mps-floor: 70
```

> `--ouroboros` 는 `--diff`, `--audit`, `--score` 와 조합 불가.

---

## 인증

| 백엔드 | 설정 | 비용 |
|--------|------|------|
| `codex-cli` *(가능 시 기본)* | `codex login` | **무료** (ChatGPT OAuth) |
| OpenAI 호환 HTTP | `PATINA_API_KEY=...` | 프로바이더별 |
| Google Gemini | `GEMINI_API_KEY=...` + `--provider gemini` | 무료 티어 |
| Groq | `GROQ_API_KEY=...` + `--provider groq` | 무료 티어 |
| Together AI | `TOGETHER_API_KEY=...` + `--provider together` | 무료 모델 있음 |
| OpenRouter | `--base-url https://openrouter.ai/api/v1` + 키 | 프로바이더별 |

```bash
patina auth status         # 백엔드 가용성 + 인증 상태
patina auth login          # 백엔드별 로그인 안내
patina --list-providers    # 프리셋 프로바이더 + 키 설정 여부
```

`PATINA_API_KEY` 가 없고 `codex` 가 로그인되어 있으면 자동으로 `codex-cli` 로 fallback.

> `codex-cli` v1 은 단일 모드 재작성만 지원. `--audit`, `--score`, `--diff`, `--ouroboros`, `--models`/MAX 는 여전히 HTTP 백엔드 사용.

기본 환경 변수:

```bash
PATINA_API_KEY=...                            # HTTP 백엔드 필수
PATINA_API_BASE=https://api.openai.com/v1     # 또는 프록시
PATINA_MODEL=gpt-4o                           # 기본 모델
```

---

## 동작 원리

```
입력 텍스트
  │
  ▼
[4.5단계]    의미 앵커 추출
             (핵심 주장, 극성, 인과관계, 수치)
  │
  ▼
[4.6단계]    문체 통계 전처리
             (burstiness CV + MATTR)
  │
  ▼
[4.7단계]    AI 어휘 오버랩
             (평면 사전: 영어 ~108개 / 한국어 102개)
  │
  ▼
[Phase 1]    구조 스캔
             (단락 수준: 반복, 수동태)
  │
  ▼
[5a-v단계]   앵커 검증
  │
  ▼
[Phase 2]    문장 재작성
             (어휘 수준: AI 어휘, 채움 표현, 헤징)
  │
  ▼
[5b-v단계]   앵커 검증
  │
  ▼
[Phase 3]    자기검수
             (극성 스캔, 회귀 체크, 최종 MPS)
  │
  ▼
자연스러운 텍스트 (의미 검증 완료)
```

패턴 팩은 언어 접두사 (`{lang}-*.md`) 로 자동 탐색됩니다. 의미 앵커는 재작성 전에 추출되고 각 단계 후 검증됩니다 — 의미가 손상되면 재시도하거나 롤백합니다.

---

## 캘리브레이션

`.omc/research/v3_7_lexicon_eval.py` 로 400단락 코퍼스 (HC3 + Wikipedia + NamuWiki + paired ko/AI) 에 대해 재현 가능:

| 출처 | Hot rate | 비고 |
|------|----------|------|
| HC3 ChatGPT (en) | **76%** | AI 탐지율 |
| HC3 human (en) | 19% | 실제 사람 글 오탐 |
| Wikipedia (en) | 25% | 백과사전체는 균일한 문장 길이 — 본질적 한계 |
| NamuWiki (ko) | 13% | 한국어 사람 글 오탐 |
| ko/AI corpus | **91%** | 시스템 내 최강 신호 *(post-v3.8.0)* |

수용 기준: AI 탐지 ≥ 75% · 최대 FP ≤ 25% · NamuWiki 회귀 ≤ +5pp. 모두 충족.

> 문체 통계 + 어휘 신호는 LLM 에 대한 **참고 표시**일 뿐, 단독 결정 게이트가 아닙니다. Wikipedia 25% FP 는 백과사전체 본질로, 튜닝으로 제거할 수 없습니다. `core/stylometry.md` §13, §16 에 문서화.

---

## 패턴

4개 언어 모두 동일한 6개 카테고리 구조를 공유합니다. 대부분의 패턴은 범언어적이며, 일부 슬롯만 언어별 구현이 다릅니다. 패턴 #30 (수사적 질문 단락 시작) 과 #31 (결론 신호어 남용) 은 4개 언어 모두에 있습니다. 패턴 #32 (비교부사 남용 — KO `보다`, JA `より`) 는 한국어/일본어 전용입니다.

### 공통 카테고리

<details>
<summary><b>내용</b> — 6개 패턴 (#1–#6)</summary>

| # | 패턴 | AI가 하는 것 | 교정 방법 |
|---|------|-------------|---------|
| 1 | 중요성 과장 | "획기적인 이정표" | 구체적 사실, 날짜, 숫자 |
| 2 | 미디어/유명도 과장 | "NYT, BBC 등에 보도" | 구체적인 기사 하나 인용 |
| 3 | 피상적 -ing 분석 | "-하며, -보여주며" 연쇄 | 실제 설명 또는 출처 |
| 4 | 홍보성 표현 | "놀라운, 세계적, 숨겨진 보석" | 사실 기반 중립 묘사 |
| 5 | 모호한 출처 | "전문가들은... 연구에 따르면" | 실제 출처를 밝힘 |
| 6 | 공식적 도전/전망 | "도전에도 불구하고... 밝은 미래" | 구체적 문제와 실행 계획 |

</details>

<details>
<summary><b>소통</b> — 4개 패턴 (#19–#21, #29)</summary>

| # | 패턴 | AI가 하는 것 | 교정 방법 |
|---|------|-------------|---------|
| 19 | 챗봇 표현 | "도움이 되셨길 바랍니다!" | 완전 삭제 |
| 20 | 학습 시점 고지 | "구체적 정보는 제한적입니다" | 출처 찾거나 삭제 |
| 21 | 아부하는 어투 | "좋은 질문입니다!" | 바로 답변 |
| 29 | 거짓 뉘앙스 | "사실 좀 더 미묘한 문제인데요" | 새 근거 제시 또는 삭제 |

</details>

<details>
<summary><b>군더더기 & 헤징</b> — 3개 패턴 (#22–#24)</summary>

| # | 패턴 | AI가 하는 것 | 교정 방법 |
|---|------|-------------|---------|
| 22 | 군더더기 표현 | 불필요한 채우기 단어 | 간결하게 |
| 23 | 과도한 헤징 | 지나치게 조건을 다는 진술 | 직접적 진술 |
| 24 | 모호한 긍정 결론 | "밝은 미래가 기다리고 있다" | 구체적 계획 또는 사실 |

</details>

### 언어별 슬롯

<details>
<summary><b>언어</b> (#7–#12) — 문법 및 어휘</summary>

| # | 한국어 | 영어 | 중국어 | 일본어 |
|---|--------|------|--------|--------|
| 7 | AI 충전어 남용 | AI 어휘 (delve, tapestry) | AI 유행어 (赋能/助力) | AI 버즈워드 남용 |
| 8 | -적 접미사 남용 | 계사 회피 ("serves as") | 사자성어 남용 (成语) | -teki (的) 접미사 남용 |
| 9 | 부정 병렬구문 | 부정 병렬구문 | 的/地/得 과잉 정규화 | 부정 병렬구문 |
| 10 | 세 항목 규칙 | 세 항목 규칙 | 배비구 남용 (排比句) | 세 항목 규칙 |
| 11 | 유의어 순환 | 유의어 순환 | 유의어 순환 | 유의어 순환 |
| 12 | 장황한 조사 | 거짓 범위 ("from X to Y") | 장황한 전치사 구문 | 가타카나 외래어 남용 |

</details>

<details>
<summary><b>문체</b> (#13–#18) — 서식 및 문체</summary>

| # | 한국어 | 영어 | 중국어 | 일본어 |
|---|--------|------|--------|--------|
| 13 | 접속어 남용 | 엠 대시 남용 | 접속어 남용 | 접속어 남용 |
| 14 | 볼드 남용 | 볼드 남용 | 볼드 남용 | 볼드 남용 |
| 15 | 인라인 헤더 목록 | 인라인 헤더 목록 | 인라인 헤더 목록 | 인라인 헤더 목록 |
| 16 | 진행형 남용 (-고 있다) | 제목 대문자 | 地-부사 남용 | 과도한 경어 (ございます) |
| 17 | 이모지 | 이모지 | 이모지 | 이모지 |
| 18 | 과도한 격식체 | 둥근 따옴표 | 관료적 공문체 (公文体) | 딱딱한 である체 |

</details>

<details>
<summary><b>구조</b> (#25–#28) — 문서 수준</summary>

| # | 한국어 | 영어 | 중국어 | 일본어 |
|---|--------|------|--------|--------|
| 25 | 구조적 반복 | 메트로놈식 문단 | 구조적 반복 | 구조적 반복 |
| 26 | 번역투 | 수동 명사화 연쇄 | 번역투/유럽식 문법 | 번역투 |
| 27 | 수동태 남용 | 좀비 명사 | 被 남용 | ている 진행형 남용 |
| 28 | 불필요한 외래어 | 중첩 종속절 | 总分总 구조 남용 | 기승전결 공식 남용 |

</details>

### 범언어 확장 (v3.4.0+)

| # | 모든 언어 |
|---|----------|
| 30 | 수사적 질문 단락 시작 ("Have you ever wondered…?", "혹시 ~인가요?") |
| 31 | 결론 신호어 남용 ("In conclusion", "결론적으로", "总而言之", "結論として") |
| 32 | 비교부사 남용 — 한국어 `보다` / 일본어 `より` 만 해당 |

---

## 설정

```yaml
# .patina.default.yaml
version: "3.8.0"
language: ko              # ko | en | zh | ja
profile: default
output: rewrite           # rewrite | diff | audit | score
skip-patterns: []         # 예: [ko-filler]로 특정 팩 건너뛰기
blocklist: []             # 추가로 탐지할 단어
allowlist: []             # 절대 탐지하지 않을 단어
max-models: [claude, gemini]
dispatch: omc             # omc | direct
```

패턴 팩은 언어 접두사로 자동 탐색됩니다 — 수동 등록 불필요.

---

## 프로필

| 프로필 | 톤 | 용도 |
|--------|----|------|
| `default` | 원문 톤 유지 | 범용 |
| `blog` | 개인적, 주관적 | 블로그, 에세이 |
| `academic` | 격식, 근거 기반 | 연구 논문, 학위 논문 |
| `technical` | 명확, 정밀, 의견 배제 | API 문서, README, 가이드 |
| `social` | 캐주얼, 짧게, 이모지 OK | 트위터/X, 인스타그램, 스레드 |
| `email` | 정중하되 간결 | 비즈니스 이메일, 공식 서한 |
| `legal` | 법률 관행 보존 | 계약서, 법률 의견서 |
| `medical` | 의학 정밀도 보존 | 임상 보고서, 의학 논문 |
| `marketing` | 설득력, 구체적 | 광고 카피, 보도자료 |
| `formal` | 전문적, 간결 | 이력서, 자기소개서, 제안서 |

```bash
patina --profile blog text...
```

---

## 커스텀 패턴

`custom/patterns/` 에 `.md` 파일을 넣으면 자동 로드됩니다:

```markdown
---
pack: my-patterns
language: ko
name: My Custom Patterns
version: 1.0.0
patterns: 1
---

### 1. 패턴 이름
**문제:** AI가 잘못하는 것
**Before:** > AI스러운 예시
**After:** > 자연스러운 교정
```

---

## 프로젝트 구조

```
patina/
├── SKILL.md                  # /patina 진입점
├── SKILL-MAX.md              # MAX 모드 참고 문서
├── patina-max/               # /patina-max 스킬 (설치 가능)
│   └── SKILL.md
├── .patina.default.yaml      # 설정
├── core/
│   ├── voice.md              # 보이스 & 개성 가이드라인
│   ├── scoring.md            # 스코어링 알고리즘 레퍼런스
│   └── stylometry.md         # 문체 통계 알고리즘 레퍼런스
├── lexicon/
│   ├── ai-en.md              # 영어 AI 어휘 사전 (108개 항목)
│   └── ai-ko.md              # 한국어 AI 어휘 사전 (102개 항목)
├── patterns/
│   ├── ko-*.md               # 한국어 (6 팩, 32 패턴)
│   ├── en-*.md               # 영어 (6 팩, 31 패턴)
│   ├── zh-*.md               # 중국어 (6 팩, 31 패턴)
│   └── ja-*.md               # 일본어 (6 팩, 32 패턴)
├── profiles/                 # 톤 프리셋
├── examples/                 # 적용 전/후 테스트 케이스
└── custom/                   # 사용자 확장 (gitignored)
```

[oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh) 의 플러그인 아키텍처에서 영감: 패턴은 플러그인, 프로필은 테마.

---

## 새 언어 추가

1. `patterns/{lang}-content.md`, `{lang}-language.md` 등을 생성합니다.
2. 각 파일의 프론트매터에 `language: {lang}` 을 설정합니다.
3. `/patina --lang {lang}` 으로 사용 — 자동 탐색되므로 설정 변경 불필요.

---

## 참고 자료

- [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) — 패턴의 주요 출처
- [WikiProject AI Cleanup](https://en.wikipedia.org/wiki/Wikipedia:WikiProject_AI_Cleanup) — 커뮤니티 활동
- [blader/humanizer](https://github.com/blader/humanizer) — 영어 원본 버전

## 기여하기

[CONTRIBUTING.md](CONTRIBUTING.md) 참조. 패턴 추가와 **노화 신고** ("이 신호는 더 이상 AI 가 아니다") 가 가장 가치 있는 기여입니다 — AI 글쓰기 패턴은 모델이 파인튜닝되면서 바뀝니다.

[이슈 열기 →](https://github.com/devswha/patina/issues)

---

## 버전 이력

| 버전 | 핵심 변경 |
|------|----------|
| **3.8.0** | 한국어 lexicon 재큐레이션 (NamuWiki vs Claude 생성 KO 차분 빈도 마이닝). 한국어 AI 탐지: 83% → **91%** (+8pp). 오탐 회귀 0pp. |
| **3.7.0** | AI 어휘 오버랩 신호 (4.7단계). 영어 108 + 한국어 90 항목. Hot 규칙을 3-신호 OR 로 확장. HC3 ChatGPT AI 탐지: 66% → **76%** — v3.5.1 이후 첫 Pareto 돌파. |
| **3.5.1** | 통계 신호 calibration 패치 — burstiness 임계 0.25 → 0.30. AI 탐지 57% → 66%. |
| **3.5.0** | 통계 기반 의심 구간 탐지 (4.6단계) — burstiness CV + MATTR. v1 = ko + en. |
| **3.4.0** | codex-cli 백엔드 (API 키 불필요), `patina auth` 서브커맨드, 무료 티어 프로바이더 단축. 패턴 #30, #31 을 4개 언어 모두에 추가, KO/JA 에 #32. CI 워크플로우 추가. |
| **3.3.0** | 의미 보존 시스템 (MPS). |
| **3.2.0** | 우로보로스 스코어링 + 반복 자기개선 루프. |
| **3.1.x** | MAX 모드 안정성, 멀티 CLI 디스패치 (claude / codex / gemini). |
| **3.0.0** | 다국어 프레임워크, `--lang` 플래그, blader/humanizer 기반 영어 패턴, 스킬 이름 `patina` 로 변경. |
| **2.x** | 플러그인 아키텍처, blog 프로필, 구조 패턴, 외래어 패턴 (#28). |
| **1.0.0** | 한국어 초기 적용 (24개 패턴). |

<details>
<summary><b>상세 릴리스 노트</b></summary>

#### 3.8.0 — 데이터 기반 한국어 lexicon 마이닝

v3.7.0 의 한국어 lexicon 은 author 직관 큐레이션이라 AI 탐지에 +1pp 만 기여 (영어 +10pp 대비). v3.8.0 은 NamuWiki 인간 산문과의 차분 빈도로 코퍼스를 마이닝해, AI 텍스트가 자주 쓰지만 사람은 거의 안 쓰는 12개 register marker 를 발굴.

마이닝 규칙 (`.omc/research/v3_8_ko_lexicon_mine.py`):
- 어절 doc-frequency: AI count ≥ 4 AND 비율 AI / (human + 1) ≥ 4.0
- 도메인 아티팩트 제외 (고유명사, year-token)
- register marker 만 유지 (수동 평가 동사, 백과사전적 동사, 수량어 비계)

추가된 항목:
- Strict (8개): `평가된다`, `꼽힌다`, `가리킨다`, `사례로`, `다수의`, `알려져`, `일컬어진다`, `평가받다`
- Phrase (4개): `가운데 하나로`, `자리 잡았다`, `알려져 있다`, `~의 사례로`

500단락 코퍼스 결과: ko/AI catch 83% → **91%** (+8pp). NamuWiki human FP **13% 유지** — 회귀 0pp, clean Pareto 개선.

#### 3.7.0 — AI 어휘 오버랩 신호

평면 사전 (`lexicon/ai-en.md` 108 항목, `lexicon/ai-ko.md` 90 항목) 으로 28-패턴 카탈로그가 명명하지 못하는 AI 특유 어구를 매칭. 1,000 토큰당 발견 횟수 (density) 를 계산해, 4.6단계 hot 규칙을 3-signal OR (burstiness OR MATTR OR lexicon_density > 2.0) 로 확장.

400단락 calibration: AI catch 66% → **76%**, HC3 human FP 12%→19%, Wikipedia FP 23%→**25%** 경계, NamuWiki FP 11%→13% (+5pp 가드 내). 모든 acceptance 기준 충족 — v3.5.1 Pareto 벽 첫 돌파.

Drop list (eval 후): `intersection`, `principles`, `mindset`, `iterative`, `responsible`, `methodologies`, `redefine`, `accessible`, `equitable`, `one of the most`, `in conjunction with`, `the power of` — 학술 prose 발화율이 AI 발화율보다 높았음.

v3.6 건너뜀 (n-gram drop, §15 negative finding).

#### 3.5.1 — 통계 신호 calibration 패치

300단락 외부 검증 후 `stylometry.burstiness.bands.low` 를 0.25 → 0.30 으로 상향. v3.5.0 은 실제 AI 의 57% 만 탐지 — v3.5.1 은 66% 탐지 + HC3 human FP 12% + Wikipedia FP 23%.

Sweep 결과 AI ≥70% AND max FP ≤20% 동시 만족 임계값 조합 없음 — Wikipedia 백과사전체는 균일한 문장 길이가 자연스럽기 때문. MATTR 임계값 0.55 유지. v3.5.x 는 LLM advisory marker 이지 단독 결정 신호가 아님.

</details>

---

## 라이선스

MIT
