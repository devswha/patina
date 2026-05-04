한국어 | **[English](README.md)** | **[中文](README_ZH.md)** | **[日本語](README_JA.md)**

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code Skill](https://img.shields.io/badge/Claude%20Code-Skill-blueviolet)](https://docs.anthropic.com/en/docs/claude-code)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-3.8.0-blue)](CHANGELOG.md)

> **AI가 쓴 글을 사람이 쓴 것처럼 바꿔줍니다.**

한국어, 영어, 중국어, 일본어 텍스트에서 AI 특유의 글쓰기 패턴을 탐지하고 교정하는 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 스킬 + 독립형 CLI. 패턴 기반, 감사 가능 — 블랙박스 LLM 패러프레이저가 아닙니다. 스코어링 공식은 결정적이지만 LLM severity 부여 단계는 ±8–10pt 변동이 있습니다 ([scoring.md §8](core/scoring.md) 참조).

## 데모

**수정 전** *(AI스러운 글)*:
> 커피는 전 세계 사회적 상호작용을 **근본적으로 변화시킨** **핵심적인 문화 현상**으로 부상했습니다. 이 사랑받는 음료는 커뮤니티 구축의 촉매제 역할을 하며, 의미 있는 연결을 촉진하고, 문화 간 대화를 이끌어냅니다.

**수정 후** *(`/patina --lang ko` — 같은 내용, AI 포장만 제거)*:
> 커피는 사람들이 만나는 방식을 꽤 많이 바꿔놓았다. 누군가와 마주 앉아 이야기하다 보면 자연스럽게 관계가 생기고, 문화가 다른 사람끼리도 대화가 이어진다.

> **MPS = 100** · 사회적 변화 ✓ · 커뮤니티 구축 ✓ · 의미 있는 연결 ✓ · 문화 간 대화 ✓

## 한눈에 보기

|  |  |
|---|---|
| **126개 패턴** | 한국어 32 + 영어 31 + 중국어 31 + 일본어 32 — [PATTERNS.md](docs/PATTERNS.md) |
| **AI 탐지율** | 한국어 91% / 영어 76% (HC3) |
| **오탐율** | 사람 글에 13–25% *(백과사전체의 본질적 한계, [문서화](core/stylometry.md))* |
| **모드** | rewrite · audit · score · diff · ouroboros |
| **무료 사용** | 가능 — `codex` CLI 로그인 시 API 키 불필요 |
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
| `--batch <glob>` | 여러 파일 일괄 처리 |

전체 옵션은 `patina --help`.

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
version: "3.8.0"
language: ko              # ko | en | zh | ja
profile: default
output: rewrite           # rewrite | diff | audit | score
max-models: [claude, gemini]
```

패턴 팩은 언어 접두사로 자동 탐색됩니다. 작업 디렉토리의 `.patina.yaml` 이 기본값을 오버라이드합니다.

## 문서

- **[Patterns](docs/PATTERNS.md)** — 126개 패턴 카탈로그
- **[Authentication](docs/AUTHENTICATION.md)** — 백엔드, 프로바이더, 무료 티어 설정
- **[Stylometry](core/stylometry.md)** — burstiness + MATTR + AI 어휘 알고리즘
- **[Scoring](core/scoring.md)** — AI 유사도 + 충실도 + MPS
- **[Changelog](CHANGELOG.md)** — 릴리스 노트와 방법론
- **[Contributing](CONTRIBUTING.md)** — 패턴 추가, 노화 신고

## 영감

[oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh) 플러그인 아키텍처 (패턴 = 플러그인, 프로필 = 테마), [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), [blader/humanizer](https://github.com/blader/humanizer).

## 라이선스

MIT
