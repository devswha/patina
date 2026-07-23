한국어 | **[English](README.md)** | **[中文](README_ZH.md)** | **[日本語](README_JA.md)**

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Skill](https://img.shields.io/badge/Skill-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%20OpenCode-blueviolet)](#빠른-시작)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-6.3.1-blue)](CHANGELOG.md)

<p align="center">
  <a href="https://patina.vibetip.help/"><b>브라우저에서 바로 써보기 — 설치 없음</b></a>
</p>

> **AI 포장만 벗기고, 의미는 그대로.**

patina는 한국어·영어·중국어·일본어를 위한 결정론적 패턴 기반 휴머나이저입니다. AI가 쓴 듯한 표현을 찾아내고, 원문의 주장·수치·극성·인과관계를 바꾸지 않은 채 문장만 다시 씁니다.

블랙박스형 패러프레이저도, 작성자 판별기도, 탐지기 우회 도구도 아닙니다. patina는 AI 도움을 받아도 되는 상황에서 초안을 다듬으려는 작성자를 위한 도구입니다 — 더 깔끔한 문체, 감사 추적, 그리고 의미 보존 검사를 원하는 경우에 맞춰져 있습니다.

## 데모

AI 티가 나는 글을 **[playground](https://patina.vibetip.help/)** 에 붙여넣으면 patina가 그 자리에서 다시 씁니다. 의미 하한이 재작성을 검증하고(여기서는 **MPS 100 / Fidelity 75** — "30개 템플릿"이라는 사실이 살아남습니다), 결정론적 AI 시그널을 before → after로 측정합니다. 핫 문단 비율은 **100 → 0** 으로 떨어지고, 과장 표현("thrilled to announce", "revolutionize your workflow", "unlock their full potential")은 사라집니다.

<p align="center">
  <img src="https://raw.githubusercontent.com/devswha/patina/main/assets/demo/patina-playground-en.gif" alt="patina playground 데모 애니메이션: AI 티가 나는 템플릿 팩 홍보 글을 웹 playground에 붙여넣으면 30개 템플릿이라는 사실은 유지한 채 자연스럽게 다시 쓰이고, MPS 100·Fidelity 75와 결정론적 AI 시그널이 100에서 0으로 떨어지는 것으로 검증됩니다" width="820">
</p>

더 많은 예시: [Before/After 갤러리](docs/EXAMPLES_KR.md) ([English](docs/EXAMPLES.md)) · [CLI transcript](docs/DEMO.md).

## 빠른 시작

### 브라우저 playground

**[patina.vibetip.help](https://patina.vibetip.help/)** 를 열고 KO / EN / ZH / JA 문장을 붙여넣으면 MPS/충실도 하한으로 게이팅된 실제 리라이트를 받아볼 수 있고, 결정론적 AI 시그널이 before → after로 측정됩니다. 리라이트와 채점은 서버에서 실행되며, 무료 티어는 서비스 자체 모델 키를 사용합니다(요청량 제한). **API 모드**는 요청마다 개인 키를 patina 서버를 경유해 선택한 프로바이더로 전달할 뿐, 저장하거나 로깅하지 않습니다(메트릭은 텍스트·프롬프트·출력·키·IP 없이 정제됩니다).

### 에이전트 스킬

**코딩 에이전트에게 설치를 맡기세요** — Claude Code, Codex CLI, Cursor, Gemini CLI 등 아무 에이전트에나 아래를 붙여넣으세요:

```text
Install patina by following https://raw.githubusercontent.com/devswha/patina/main/INSTALLATION.md
```

에이전트가 [`INSTALLATION.md`](INSTALLATION.md)(AI 에이전트용으로 작성됨)를 가져와 사용 환경에 맞는 설치 경로를 실행하고 검증합니다. 직접 하려면:

**Claude Code — 플러그인 마켓플레이스 (클론 불필요, 권장):**

```text
/plugin marketplace add devswha/patina
/plugin install patina@patina
```

**Claude Code · Codex CLI · Cursor · OpenCode — 설치 스크립트:**

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

이후 Claude Code, Codex CLI, Cursor, OpenCode에서 스킬을 실행하세요:

```text
/patina --lang en

[paste your text here]
```

유용한 스킬 호출:

```text
/patina --tone professional
/patina --tone auto --lang en
```

### 독립형 CLI

Node.js 18 이상이 필요합니다.

```bash
npx patina-cli doctor
npx patina-cli --lang en input.txt
```

API 키 없이 로그인된 로컬 모델 CLI를 사용하려면:

```bash
printf '%s\n' 'Coffee has emerged as a pivotal cultural phenomenon.' \
  | npx patina-cli --lang en --backend codex-cli
```

지원 로컬 백엔드: `codex-cli`, `claude-cli`, `gemini-cli`, `kimi-cli` — patina는 백엔드별로 문서화된 가장 강력한 기본 모델을 넘깁니다. [Authentication](docs/AUTHENTICATION_KR.md) ([English](docs/AUTHENTICATION.md))를 참고하세요.

대규모 `--batch` 실행에는 OpenAI 호환 HTTP 백엔드를 권장합니다. 로컬 CLI 백엔드는 에이전트 런타임이므로 배치 안전을 위해 `--timeout-ms`, `--max-concurrency`, `--max-retries`, `--max-failures`로 보수적으로 제한됩니다.

## 한눈에 보기

|  |  |
|---|---|
| **184개 패턴** | 언어별 재작성 가능 37개 + 스코어 전용 바이럴 훅 9개(KO/EN/ZH/JA 각각 46개) — 전체 184개 패턴 카탈로그는 [PATTERNS.md](docs/PATTERNS.md) 참고 |
| **모드** | rewrite · verify · audit · score · diff |
| **사용 채널** | 에이전트 스킬 · Node CLI · 페이지 내 preview · 브라우저 playground (리라이트 + 점수) |
| **보이스** | `--persona` (내장 + 직접 제작, ko/en/zh/ja) · `--tone` 격식 · `--profile` 장르 — 고정된 우선순위로 조합 가능 |
| **무료 사용** | 로그인된 `codex`, `claude`, `gemini` CLI 중 하나로 `PATINA_API_KEY` 없이 재작성 실행 |
| **캘리브레이션** | GPT-5.5 / Claude Sonnet 4.6 / Gemini 2.5 Pro 기준 편집 핫스팟 catch 67.3% [63.5–71.0%] (n=600, KO+EN); KO+EN 사람 글 컨트롤에서 오탐 16.0% [11.6–21.7%] (n=200) |
| **라이선스** | MIT |

점수는 오탐과 미탐이 있는 편집 신호이지 작성자 판정의 근거가 아닙니다. [Ethics](docs/ETHICS.md)를 참고하세요.

## 자주 쓰는 명령

```bash
patina --lang <ko|en|zh|ja> [mode] [--profile <name>] input.txt
```

| 명령 | 목적 |
|---|---|
| `patina input.txt` | 기본값으로 재작성 |
| `patina --audit input.txt` | 패턴 탐지만 수행 |
| `patina --score input.txt` | 0-100 AI 유사도 점수 출력 |
| `patina --score --exit-on 30 input.txt` | `overall > 30`이면 종료 코드 `3`을 내는 CI 게이트 |
| `patina --diff input.txt` | 패턴별 변경 사항 표시 |
| `patina --preview page.html` | 저장된 HTML 페이지 위에 재작성을 다시 렌더링(토글 + 인라인 diff) |
| `patina --verify input.txt` | 재작성 후 MPS/충실도 하한을 검사하고 1회 재시도 |
| `patina --tone auto --lang en input.txt` | KO/EN 톤 축을 추론해 적용 |
| `patina --persona pragmatic-founder input.txt` | 내장 보이스 페르소나로 재작성 |
| `patina persona new my-voice --from-sample past.txt` | 글 샘플에서 나만의 페르소나 제작 |
| `patina persona list` | 내장 + 커스텀 페르소나 목록 |
| `patina --format json --quiet input.txt` | 스크립트 친화적 출력 |
| `patina --batch docs/*.md --outdir cleaned/` | 배치 파일 처리 |

`patina --help`는 전체 플래그 목록을 출력합니다. `patina doctor --json`은 LLM 호출 없이 Node, 백엔드, tmux, API 키 준비 상태를 점검합니다.

### 페르소나 (보이스)

**페르소나**는 재사용 가능한 "말투"입니다 — 내장 페르소나(`patina persona list`)를 쓰거나, 소스 코드를 건드리지 않고 직접 만들 수 있습니다:

```bash
patina persona new my-voice --from-sample past-posts.txt   # 내 글에서 학습
patina persona new my-voice --describe "plain-spoken founder, casual"
patina --persona my-voice draft.md                          # 이후 재사용
```

ko/en/zh/ja에서 동작하며 `--tone`/`--profile`과 조합됩니다(격식 우선순위 `--tone` > 페르소나 > 프로필). 페르소나는 말투를 바꿀 뿐 의미 하한을 낮추지 않습니다 — 제작한 페르소나는 저장 시 검증되고, 안전 게이트는 재작성 시 MPS/충실도 및 숫자 누락 검사를 그대로 강제합니다.

## CI

GitHub Actions에서는 손수 설정하는 것보다 유지 관리되는 래퍼가 더 간단합니다:

```yaml
name: Patina prose score
on:
  pull_request:
    paths: ['**/*.md', '**/*.mdx']
permissions:
  contents: read
  pull-requests: read
  issues: write
jobs:
  patina:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: devswha/patina-action@v1
        with:
          score-threshold: 30
          lang: auto
          comment: true
```

기타 연동: [pre-commit](docs/integrations/pre-commit.md), [static sites](docs/integrations/static-sites.md), [Docker](docs/integrations/docker.md), [release workflow](docs/integrations/release.md).

## 동작 원리

```text
Input
  -> semantic anchor extraction (claims, polarity, causation, numbers)
  -> stylometry + AI-lexicon scan
  -> pattern-guided rewrite
  -> self-audit and MPS/fidelity checks
  -> cleaned text
```

의미가 어긋나면 해당 변경을 재시도하거나 롤백합니다. 결정론적 분석은 `src/features/*`에 있으며, LLM 기반 재작성과 점수 호출은 선택한 백엔드를 사용합니다.

## 설정

```yaml
# .patina.default.yaml
version: "6.3.1"
language: ko              # ko | en | zh | ja
profile: default
output: rewrite           # rewrite | diff | audit | score
tone:                     # casual | professional | auto  (register; genre = profile)
```

프로젝트의 `.patina.yaml`이 기본값을 오버라이드합니다. 패턴 팩은 언어 접두사로 자동 탐색됩니다. 추가형 목록 키(`blocklist`, `allowlist`, `skip-patterns`)는 병합되고, 다른 배열은 대체됩니다.

## 문서

여기서 시작하세요:

- [Cookbook](docs/COOKBOOK.md) — 자주 쓰는 recipe와 워크플로우
- [CLI Contract](docs/CLI.md) — 플래그, 포맷, score gate, 종료 동작
- [Authentication](docs/AUTHENTICATION_KR.md) ([English](docs/AUTHENTICATION.md)) — 로컬 CLI 백엔드와 API 프로바이더
- [Patterns](docs/PATTERNS.md) — 전체 패턴 카탈로그
- [Subagents & strict flow](docs/agents.md) — 선택형 read-only detector/fidelity/naturalness 서브에이전트와 `--strict` 멀티패스 모드
- [Benchmarks](docs/benchmarks/README.md) · [latest report](docs/benchmarks/latest.md) · [2026 rebaseline](docs/research/2026-rebaseline.md)
- [Measurement harness](docs/HARNESS.md) — 모든 벤치마크·보정·게이트 도구의 인덱스(신호 임팩트 ablation 하네스 포함)
- [FAQ](docs/FAQ_KR.md) ([English](docs/FAQ.md))
- [Ethics](docs/ETHICS.md)
- [Contributing](CONTRIBUTING_KR.md) ([English](CONTRIBUTING.md))
- [Changelog](CHANGELOG.md)

브랜드 리소스와 사용 규칙은 [Branding](docs/BRANDING.md)에 있습니다. 디자인 메모는 [DESIGN.md](DESIGN.md)에 있습니다.

## 영감

[oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh)의 플러그인 아키텍처, [Wikipedia의 "Signs of AI writing"](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), [blader/humanizer](https://github.com/blader/humanizer)에서 영감을 받았습니다.

## 라이선스

MIT. [LICENSE](LICENSE)와 [NOTICE](NOTICE)를 참고하세요.
