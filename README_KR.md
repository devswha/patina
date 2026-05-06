한국어 | **[English](README.md)** | **[中文](README_ZH.md)** | **[日本語](README_JA.md)**

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Skill](https://img.shields.io/badge/Skill-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%20OpenCode-blueviolet)](#빠른-시작)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-3.11.0-blue)](CHANGELOG.md)

> **AI 포장만 벗기고, 의미는 그대로.**

한국어, 영어, 중국어, 일본어 텍스트에서 AI 특유의 글쓰기 패턴을 탐지하고 교정합니다. [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex), [Cursor](https://cursor.sh), OpenCode 용 스킬 또는 독립형 Node.js CLI 로 동작합니다.

일반적인 패러프레이저와 달리 patina는 **패턴 기반이고 감사 가능**합니다. 무엇을, 왜 바꿨는지, 그리고 원문의 주장이 보존됐는지를 보여줍니다.

## 데모

**수정 전** *(AI스러운 글)*:
> 커피는 전 세계 사회적 상호작용을 **근본적으로 변화시킨** **핵심적인 문화 현상**으로 부상했습니다. 이 사랑받는 음료는 커뮤니티 구축의 촉매제 역할을 하며, 의미 있는 연결을 촉진하고, 문화 간 대화를 이끌어냅니다.

**수정 후** *(`/patina --lang ko` — 같은 내용, AI 포장만 제거)*:
> 커피는 사람들이 만나는 방식을 꽤 많이 바꿔놓았다. 누군가와 마주 앉아 이야기하다 보면 자연스럽게 관계가 생기고, 문화가 다른 사람끼리도 대화가 이어진다.

> **MPS = 100** · 사회적 변화 ✓ · 커뮤니티 구축 ✓ · 의미 있는 연결 ✓ · 문화 간 대화 ✓

## 한눈에 보기

|  |  |
|---|---|
| **146개 패턴** | 한국어 37 + 영어 36 + 중국어 36 + 일본어 37 (각 5개 스코어 전용 viral-hook 포함) — [PATTERNS.md](docs/PATTERNS.md) |
| **AI 탐지율** | 한국어 91% / 영어 76% (HC3) |
| **오탐율** | 사람 글에 13–25% *(백과사전체의 본질적 한계, [문서화](core/stylometry.md))* |
| **모드** | rewrite · audit · score · diff · ouroboros |
| **무료 사용** | 가능 — `codex` CLI 로그인 시 API 키 불필요 |
| **결정성** | 스코어링 공식은 결정적이지만 LLM severity 부여 단계는 ±8–10pt 변동 ([scoring.md §8](core/scoring.md)) |
| **라이선스** | MIT |

## 빠른 시작

### Claude Code 또는 Codex CLI 스킬로

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

설치 스크립트가 Claude Code, [Codex CLI](https://github.com/openai/codex), Cursor, OpenCode 에 한 번에 연결합니다. 그런 다음:

```
/patina --lang ko

[텍스트를 여기에 붙여넣기]
```

특정 톤으로 재작성:

```
/patina --tone narrative

[에세이 초안을 여기에 붙여넣기]
```

자동 톤 감지:

```
/patina --tone auto --lang ko

[텍스트를 여기에 붙여넣기]
```

### 독립형 CLI 로

Node.js ≥ 18 필요.

```bash
git clone https://github.com/devswha/patina.git
cd patina && npm install && npm link
patina --lang ko input.txt
```

> 🆓 **API 키 없이 무료 사용 가능** — [`codex`](https://github.com/openai/codex) CLI 로그인만 되어 있으면 됩니다. 전체 백엔드는 [AUTHENTICATION.md](docs/AUTHENTICATION.md) 참조.

## 모드

```
patina --lang <ko|en|zh|ja> [모드] [--profile <이름>] input.txt
```

| 플래그 | 기능 |
|--------|------|
| *(기본)* | 재작성 |
| `--audit` | AI 패턴 탐지만 수행 |
| `--score` | 0–100 AI 유사도 점수 + 카테고리별 분석 |
| `--diff` | 변경 사항을 패턴별로 표시 |
| `--ouroboros` | 점수가 수렴할 때까지 반복 (MPS 롤백 포함) |
| `--lang <ko\|en\|zh\|ja>` | 언어 선택 (기본값: `ko`) |
| `--profile <이름>` | 톤 프리셋: `blog`, `academic`, `technical`, `formal`, `social`, `email`, `legal`, `medical`, `marketing` |
| `--tone <이름>` | 톤 카테고리: `casual`, `professional`, `academic`, `narrative`, `marketing`, `instructional`, `auto` |
| `--batch` | 위치 인자를 파일 목록으로 처리 (예: `--batch docs/*.md`) |

전체 옵션은 `patina --help`.

### 스코어 전용 패턴

`--score`와 `--audit`는 `--rewrite`보다 약간 더 넓은 신호를 측정합니다. 한국어 팩 `ko-viral-hook` (숫자 충격 훅, 클릭베이트 미스터리 종결, 검증 회피 단언, 호흡 최적화 단문 배열, AI 인플루언서 어휘 5개 패턴)은 **탐지 전용**입니다 — score와 audit에는 나타나서 SNS 마케팅 카피에 대한 사용자 직관과 점수가 일치하도록 하지만, `--rewrite`/`--diff`/`--ouroboros`는 이 신호들이 의도된 수사일 수 있어 건너뜁니다. 실제 데모: [`examples/viral-hook/`](examples/viral-hook/).

## 톤

`--tone` 은 패턴 재작성 위에 적용되는 명명된 보이스 축입니다. 우선순위: `--tone` CLI > `tone:` 설정 > `profile:` 설정.

| 톤 | 용도 | 주요 특성 |
|----|------|-----------|
| `casual` | 블로그, SNS, 개인 메모 | 축약, 1인칭, 이모티콘 허용, 낮은 격식 |
| `professional` | 업무 메일, 보고서, 비즈니스 | 명확하고 간결, 격식 있되 딱딱하지 않음 (legal/medical 하위 프로필은 fidelity 하한 강제) |
| `academic` | 논문, 연구 요약, 기술 분석 | 객관적, 근거 중심, 1인칭 최소화 |
| `narrative` | 에세이, 회고록, 경험담 | 1인칭 중심, 장면 디테일, 감정의 흐름 |
| `marketing` | 광고 카피, 랜딩 페이지, 제품 알림 | 짧고 강한 문장, 설득력, CTA 친화 |
| `instructional` | 튜토리얼, 하우투, 기술 문서 | 명령형 동사, 번호 매김 구조, 추측 표현 억제 |

`--tone auto` 는 휴리스틱(어휘 + 구조 신호)으로 가장 적합한 톤을 자동 선택합니다. zh/ja 에서는 `auto` 포함 모든 톤 지정 시 경고를 내고 프로필 전용 모드로 폴백합니다 — Phase 4.5b 휴리스틱이 ko/en만 지원하기 때문입니다.

### MAX 모드

같은 텍스트를 Claude, Codex, Gemini 에 독립적으로 돌립니다. MPS ≥ 70 을 통과한 결과 중 AI 점수가 가장 낮은 (가장 사람다운) 결과가 선택됩니다:

```
/patina-max

[텍스트를 여기에 붙여넣기]
```

## 동작 원리

```
입력
  ↓
[4.5단계]    의미 앵커 추출 (주장, 극성, 인과관계, 수치)
[4.6단계]    문체 통계 전처리 (burstiness CV + MATTR)
[4.7단계]    AI 어휘 오버랩 (영어 ~108 / 한국어 102 항목)
[Phase 1]    구조 스캔 + 앵커 검증
[Phase 2]    문장 재작성 + 앵커 검증
[Phase 3]    자기검수 (극성, 회귀, MPS)
  ↓
자연스러운 텍스트 (의미 검증 완료)
```

각 검증 단계에서 의미가 손상되면 재시도하거나 롤백합니다.

**캘리브레이션** *(500단락 코퍼스, `.omc/research/v3_8_remeasure.py` 로 재현 가능)*: HC3 ChatGPT (en) AI 탐지 76%, paired ko/AI 코퍼스 91%, 사람 글 오탐 13–25%. 수용 기준: AI ≥ 75%, 최대 FP ≤ 25%. 알고리즘은 [stylometry.md](core/stylometry.md).

## 설정

```yaml
# .patina.default.yaml
version: "3.11.0"
language: ko              # ko | en | zh | ja
profile: default
output: rewrite           # rewrite | diff | audit | score
tone:                     # casual | professional | academic | narrative | marketing | instructional | auto
max-models: [claude, gemini]
```

패턴 팩은 언어 접두사로 자동 탐색됩니다. 작업 디렉토리의 `.patina.yaml` 이 기본값을 오버라이드합니다.

## 문서

- **[Patterns](docs/PATTERNS.md)** — 146개 패턴 카탈로그
- **[Authentication](docs/AUTHENTICATION.md)** — 백엔드, 프로바이더, 무료 티어 설정
- **[Stylometry](core/stylometry.md)** — burstiness + MATTR + AI 어휘 알고리즘
- **[Scoring](core/scoring.md)** — AI 유사도 + 충실도 + MPS
- **[Changelog](CHANGELOG.md)** — 릴리스 노트와 방법론
- **[Contributing](CONTRIBUTING.md)** — 패턴 추가, 노화 신고

## 영감

[oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh) 플러그인 아키텍처 (패턴 = 플러그인, 프로필 = 테마), [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), [blader/humanizer](https://github.com/blader/humanizer).

## 라이선스

MIT
