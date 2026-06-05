한국어 | **[English](README.md)** | **[中文](README_ZH.md)** | **[日本語](README_JA.md)**

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Skill](https://img.shields.io/badge/Skill-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%20OpenCode-blueviolet)](#빠른-시작)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-4.0.0-blue)](CHANGELOG.md)

<p align="center">
  <img src="assets/demo/patina-demo-ko.gif" alt="patina가 한국어 AI풍 문장을 다듬고 결과 점수를 보여주는 터미널 데모 GIF" width="780">
</p>

<p align="center">
  <a href="https://patina.vibetip.help/"><b>내 글로 바로 시험하기 — 설치 없음</b></a>
</p>

> **AI 포장만 벗기고, 의미는 그대로.**

patina는 한국어·영어·중국어·일본어 글에서 AI가 쓴 듯한 표현을 찾아냅니다. 원래의 주장·수치·극성·인과관계는 유지한 채 문장만 다듬습니다. [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex), [Cursor](https://cursor.sh), OpenCode 스킬로 쓰거나 독립형 Node.js CLI로 실행할 수 있습니다.

막연히 말을 바꾸는 블랙박스형 도구도, AI 탐지기를 우회하기 위한 도구도 아닙니다. patina는 **명확한 패턴 기반**으로 작동하며, 무엇을 왜 바꿨는지와 원문의 주장이 보존됐는지를 보여줍니다. `codex`, `claude`, `gemini` CLI 중 하나에 로그인되어 있으면 API 키 없이도 쓸 수 있습니다.

## 데모

**수정 전** *(AI스러운 글; GIF와 같은 예시)*:
> 새롭게 출시된 노션 템플릿 팩은 생산성 향상을 위한 **혁신적인 솔루션**입니다. 다양한 워크플로우에 최적화된 30개의 템플릿을 제공하며, 사용자 친화적인 디자인으로 누구나 손쉽게 활용 가능합니다. 본 제품은 업무 효율성을 극대화하는 **새로운 패러다임**을 제시합니다.

**수정 후** *(`/patina --lang ko --tone marketing` — 같은 내용, AI 포장만 제거)*:
> 노션을 자주 쓰지만 매번 빈 페이지에서 막힌다면 이 팩부터 열어 보세요. 업무별 템플릿 30개를 담았습니다. 복잡한 설정 없이 복제해서 바로 고치고, 팀 프로젝트든 개인 정리든 필요한 형태로 손보면 됩니다.

> **Score = 0.0%** · 템플릿 30개 ✓ · 워크플로우 적합성 ✓ · 복제 후 수정 사용 ✓

**다른 예시**

| 입력 유형 | 제거되는 AI 포장 | 보존되는 의미 |
|---|---|---|
| 한국어 마케팅 | “혁신적인 솔루션”, “새로운 패러다임” | 노션 템플릿 30개, 업무 흐름에 맞음, 복제 후 수정해서 사용 |
| 학술 문체 | “획기적인 성과”, 넓은 의의 주장 | GitHub 프로젝트 60개, 72h→10m 설정 시간, p<0.01, 한계 명시 |
| 기술 문서 | “핵심적인 역할”, 미래 표준식 과장 | GPU 관리, 명령 한 번으로 준비, 5× 결과의 주의점 |

## 브라우저에서 바로 보기 — 설치 없음

**[patina.vibetip.help](https://patina.vibetip.help/)** 에서 KO / EN / ZH / JA 문단의 AI스러운 글쓰기 패턴을 브라우저 안에서 바로 점검할 수 있습니다.

> **탐지 전용입니다.** playground는 정해진 문체 통계 분석만 사용자 브라우저에서 실행합니다. 텍스트를 다시 쓰지 않고, 외부 LLM을 호출하지 않으며, API 키를 서버로 보내지 않습니다. 실제 재작성이 필요하면 아래 CLI나 스킬을 사용하세요.

전체 재작성 흐름은 [30초 터미널 데모](docs/DEMO.md)에서 볼 수 있습니다. 더 많은 예시는 [Before/After Gallery](docs/EXAMPLES_KR.md) ([English](docs/EXAMPLES.md))에 있습니다.
브랜드 리소스: [로고](assets/brand/patina-logo.svg), [마크](assets/brand/patina-mark.svg), [아이콘](assets/brand/patina-icon.svg), [소셜 프리뷰](assets/social/patina-og.svg), [before/after 카드](assets/social/patina-before-after.svg). 사용 가이드라인은 [BRANDING.md](docs/BRANDING.md)를 참고하세요.

## 한눈에 보기

|  |  |
|---|---|
| **168개 패턴** | 언어별 33개 재작성 패턴 + 9개 스코어 전용 바이럴 훅 패턴(KO/EN/ZH/JA 각각 42개) — [PATTERNS.md](docs/PATTERNS.md) |
| **편집 핫스팟 재현율** | 2026-05-22 최신 모델 리베이스라인: GPT-5.5 / Claude Sonnet 4.6 / Gemini 2.5 Pro 기준 전체 탐지율 67.3% [63.5–71.0%] (n=600, KO+EN) |
| **벤치마크 리포트** | 재현 가능한 ko/en/zh/ja 의심 구간 벤치마크: [overview](docs/benchmarks/README.md) · [latest.md](docs/benchmarks/latest.md) · [latest.json](docs/benchmarks/latest.json) · [2026 rebaseline](docs/benchmarks/rebaseline-latest.md) · [detector comparison](docs/benchmarks/detector-comparison.md) |
| **오탐율** | 2026-05-22 KO+EN 사람 글 컨트롤에서 16.0% [11.6–21.7%] (n=200). 문체별 경계는 [stylometry.md](core/stylometry.md)에 문서화되어 있습니다 — [오탐 제보](https://github.com/devswha/patina/issues/new?template=false_positive.yml) |
| **모드** | 재작성 · 탐지 · 점수 · diff · ouroboros |
| **무료 사용** | 로그인된 `codex`, `claude`, `gemini` CLI 중 하나로 API 키 없이 실행 |
| **결정성** | 스코어링 공식은 결정적이지만 LLM severity 판정 단계에는 ±8–10pt 변동이 있습니다 ([scoring.md §8](core/scoring.md)) |
| **라이선스** | MIT |

## 빠른 시작

### Claude Code 또는 Codex CLI 스킬로

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

설치 스크립트가 Claude Code, [Codex CLI](https://github.com/openai/codex), Cursor, OpenCode에 patina를 한 번에 연결합니다. 설치할 때 원격 HEAD를 실제 커밋으로 고정하므로, 특정 버전만 쓰고 싶다면 `PATINA_REF=<tag-or-full-sha>`를 지정하세요. 그런 다음:

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

### 독립형 CLI로

Node.js 18 이상이 필요합니다. npm 패키지가 공개되어 있어 바로 실행할 수 있습니다:

```bash
npx patina-cli doctor
npx patina-cli --lang ko input.txt
```

저장소를 직접 받아 고쳐 보려면:

```bash
git clone https://github.com/devswha/patina.git
cd patina && npm install && npm link
patina --lang ko input.txt
```

`npm link` 후에는 stdin으로도 시험할 수 있습니다:

```bash
printf '%s\n' '커피는 전 세계의 사회적 상호작용을 근본적으로 바꾼 중요한 문화 현상으로 부상했다.' \
  | patina --lang ko --backend codex-cli
```

> 🆓 **API 키 없이 무료 사용 가능** — [`codex`](https://github.com/openai/codex), [`claude`](https://docs.anthropic.com/en/docs/claude-code), [`gemini`](https://github.com/google-gemini/gemini-cli) CLI 중 하나에 로그인되어 있으면 됩니다. `--backend codex-cli | claude-cli | gemini-cli`로 직접 고르거나, `--backend claude-cli,codex-cli`처럼 백업 순서를 지정할 수 있습니다. `--model claude-*` / `--model gemini-*`처럼 모델명으로 라우팅하는 것도 가능합니다. `--model`을 생략하면 backend별 기본 모델(`gpt-5.5`, `claude-sonnet-4-6`, `gemini-2.5-pro`)을 넘깁니다. 전체 백엔드는 [AUTHENTICATION.md](docs/AUTHENTICATION.md)를 참고하세요.

### CI 연동

Patina는 모델 키 없이도 문서 리뷰용 결정론적 CI 체크를 제공합니다:

```yaml
# .github/workflows/patina.yml
name: Patina prose score

on:
  pull_request:
    paths:
      - '**/*.md'
      - '**/*.mdx'

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

Docker 이미지는 npm 릴리스와 별도로 추적합니다. GHCR 이미지가 공개되기 전에는 컨테이너가 필요할 때 로컬 이미지를 빌드하세요:

```bash
docker build -t patina:local .
printf '%s\n' '커피는 전 세계의 사회적 상호작용을 근본적으로 바꾼 중요한 문화 현상으로 부상했다.' \
  | docker run --rm -i -e PATINA_API_KEY patina:local --lang ko --provider openai
```

Pre-commit, Husky, Lefthook, Docker, 릴리스 워크플로우 메모는 [docs/integrations/](docs/integrations/)에 있습니다.

## 올바른 사용 목적

Patina는 AI 도움을 받아도 되는 상황에서 초안을 다듬기 위한 도구입니다. 어떤 부분을 왜 바꿨는지 확인하고, 원문의 의미를 유지한 채 문체만 자연스럽게 고치는 데 초점을 둡니다. 텍스트가 "원래 사람이 쓴 것"이라는 보증은 아니며, 학업 윤리 규정 회피, 출판사 고지 의무 우회, 표절 세탁, 탐지기 우회 주장에 사용해서는 안 됩니다. 점수는 글을 고치기 위한 참고 신호일 뿐, 작성자가 AI인지 사람인지 판정하는 근거가 아닙니다. [ETHICS.md](docs/ETHICS.md)를 참고하세요.

## 모드

```
patina --lang <ko|en|zh|ja> [모드] [--profile <이름>] input.txt
```

| 플래그 | 기능 |
|--------|------|
| *(기본)* | 재작성 |
| `--audit` | AI 패턴 탐지만 수행 |
| `--score` | 0–100 AI 유사도 점수 + 카테고리별 분석 |
| `--score --exit-on <n>` | CI를 엄격하게 유지: `overall > n`이면 종료 코드 `3` |
| `--diff` | 변경 사항을 패턴별로 표시 |
| `--ouroboros` | 점수가 수렴할 때까지 반복 (MPS 롤백 포함) |
| `--lang <ko\|en\|zh\|ja>` | 언어 선택 (기본값: `ko`) |
| `--profile <이름>` | 톤 프리셋: `blog`, `academic`, `technical`, `formal`, `social`, `email`, `legal`, `medical`, `marketing`, `narrative`, `instructional`, `casual-conversation`, `code-comment`, `commit-message`, `release-notes`, `namuwiki` |
| `--tone <이름>` | 톤 카테고리: `casual`, `professional`, `academic`, `narrative`, `marketing`, `instructional`, `auto` |
| `--batch` | 위치 인자를 파일 목록으로 처리 (예: `--batch docs/*.md`) |
| `--format json\|text\|markdown` | JSON, 일반 텍스트, 기본 Markdown 출력 선택 |
| `--quiet` | stderr의 상태, 경고, 진행 로그를 숨김 |

전체 옵션은 `patina --help`를 참고하세요. `patina doctor --json`은 LLM 호출 없이 Node/backend/tmux/API-key 준비 상태를 점검합니다. 프로젝트 설정은 선택 사항이며, 일회성 실행은 플래그를 쓰고 고정 기본값이 필요할 때만 `.patina.yaml`을 추가하세요.

Markdown 중심 개발 흐름에는 개발자용 프로필도 있습니다.
`code-comment`는 인라인 주석과 docstring을 줄이고, `commit-message`는 의도와 검증이 드러나는 커밋 메시지로 다듬습니다. `release-notes`는 변경 로그 항목을 사용자 영향과 마이그레이션 위험이 보이는 릴리스 노트로 바꿉니다. `namuwiki`는 한국어 전용 위키풍 프로필이며, 실제 나무위키 문서 텍스트를 복사하지 않는 license-safe 가이드만 포함합니다.

### 스코어 전용 패턴

`--score`와 `--audit`는 `--rewrite`보다 조금 더 넓은 신호를 봅니다. 바이럴 훅 팩(`ko/en/zh/ja-viral-hook`, 각 9개 패턴: 숫자 충격 훅, 클릭베이트 종결, 출처 회피 권위 주장, 호흡 최적화 단문 배열, 과장된 참여 유도 어휘, 가짜 통계 인용, 권위 타이틀 쌓기, 미래의 나/친밀한 2인칭 약속, 경구형 펀치라인)은 **탐지 전용**입니다.

이 신호들은 score와 audit에만 나타납니다. 네 언어의 SNS 마케팅 카피를 평가할 때 사용자 직관과 벤치마크를 맞추기 위한 장치입니다. `--rewrite`/`--diff`/`--ouroboros`는 이런 표현이 의도된 수사일 수 있어 건너뜁니다. 실제 데모: [`examples/viral-hook/`](examples/viral-hook/).

### 짧은 텍스트 점수 보정 (v3.11)

입력이 200자 이하이거나 3문단 이하이면 문장 스타일에 민감한 카테고리(`language`, `style`, `viral-hook`)에 1.5배 가중치를 줍니다. 짧은 단락의 미세한 어조 변화도 점수에 반영하기 위해서입니다. case-04에서 긴 글 기준 공식이 이런 신호를 과소계산한다는 점을 확인했습니다.

### 자기검수 분리 (v3.11)

rewrite 모드에서 모델은 `[BODY]`/`[/BODY]` 블록을 감싸는 `[SELF_AUDIT]`/`[/SELF_AUDIT]` 태그 안에 자기검수 메모를 냅니다. patina는 사용자에게 보여주기 전에 audit을 제거하므로 원시 출력이 깔끔합니다. 이전 버전에서는 "남아 있는 AI 티"나 "Phase 3" 같은 프리앰블이 사용자에게 보이는 텍스트에 새어 나오는 경우가 있었습니다.

### 기계가 읽기 쉬운 출력과 종료 코드

`--format json`은 모든 모드를 `overall`, `categories[]`, `tone`, `mps`, `gateResult`, 정리된 `output` 본문이 들어 있는 일관된 JSON envelope로 감싸 반환합니다. `--quiet`는 stdout만 필요한 스크립트를 위해 상태·경고·진행 로그를 숨깁니다. `--format markdown`이 기본값이고, `--format text`는 YAML tone footer 없이 사용자가 보게 될 본문만 남깁니다. 종료 코드는 [EXIT-CODES.md](docs/EXIT-CODES.md)에 정리되어 있습니다: `0` 성공, `1` runtime/backend, `2` input/usage, `3` score gate 초과.

### 점수 가중치 드리프트 감지 (v3.11)

`--score` 실행은 모델이 출력한 Weight 열을 설정의 `category-weights`와 대조합니다. 모델이 존재하지 않는 카테고리(예: `discord`)를 만들거나 다른 숫자로 바꾸면 stderr에 `[patina]` 경고가 나옵니다. 관측용 검사라서 weight check 자체가 점수를 바꾸지는 않습니다. `src/features/*`의 결정론적 shadow score도 함께 기록되며, LLM 점수와 20점 넘게 벌어지면 patina가 경고를 내고 gate에는 더 보수적인 값을 사용합니다.

`--voice-sample <path>` 또는 설정의 `voice-sample: <path>`로 본인이 쓴 1~3문단을 rewrite 기준으로 줄 수 있습니다. profile과 tone은 여전히 register를 정하고, sample은 문장 리듬, 구체성, 시점, 문장 질감만 참고합니다. prompt는 sample의 사실을 가져오지 말라고 명시합니다.

## 톤

`--tone`은 패턴 기반 재작성과 함께 적용할 수 있는 톤(어조) 프리셋입니다. 우선순위: `--tone` CLI > `tone:` 설정 > `profile:` 설정.

| 톤 | 용도 | 주요 특성 |
|----|------|-----------|
| `casual` | 블로그, SNS, 개인 메모 | 축약, 1인칭, 이모티콘 허용, 낮은 격식 |
| `professional` | 업무 메일, 보고서, 비즈니스 | 명확하고 간결, 격식 있되 딱딱하지 않음 (legal/medical 하위 프로필은 fidelity 하한 강제) |
| `academic` | 논문, 연구 요약, 기술 분석 | 객관적, 근거 중심, 1인칭 최소화 |
| `narrative` | 에세이, 회고록, 경험담 | 1인칭 중심, 장면 디테일, 감정의 흐름 |
| `marketing` | 광고 카피, 랜딩 페이지, 제품 알림 | 짧고 강한 문장, 설득력, CTA 친화 |
| `instructional` | 튜토리얼, 하우투, 기술 문서 | 명령형 동사, 번호 매김 구조, 추측 표현 억제 |

`--tone auto`는 휴리스틱(어휘 + 구조 신호)으로 가장 적합한 톤을 자동 선택합니다. zh/ja에서는 `auto`를 포함한 모든 톤 지정 시 경고를 내고 프로필 전용 모드로 폴백합니다. Phase 4.5b 휴리스틱이 ko/en만 지원하기 때문입니다.

## 동작 원리

```
입력
  ↓
[4.5단계]    의미 앵커 추출 (주장, 극성, 인과관계, 수치)
[4.6단계]    문체 통계 전처리 (burstiness CV + MATTR; zh/ja 문자 토큰 fallback)
[4.7단계]    AI 어휘 오버랩 (영어 88 / 한국어 102 / 중국어 60 / 일본어 60 항목)
[Phase 1]    구조 스캔 + 앵커 검증
[Phase 2]    문장 재작성 + 앵커 검증
[Phase 3]    자기검수 (극성, 회귀, MPS)
  ↓
자연스러운 텍스트 (의미 검증 완료)
```

각 검증 단계에서 의미가 손상되면 재시도하거나 롤백합니다.

**캘리브레이션** *(2026-05-22 최신 모델 리베이스라인; 방법론은 [2026-rebaseline.md](docs/research/2026-rebaseline.md))*: GPT-5.5, Claude Sonnet 4.6, Gemini 2.5 Pro CLI 샘플에서 결정론적 편집 핫스팟 catch는 67.3% [63.5–71.0%] (n=600, 한국어+영어)입니다. 사람 글 컨트롤 오탐은 16.0% [11.6–21.7%] (n=200)입니다. 언어×모델별 수치는 [rebaseline-latest.md](docs/benchmarks/rebaseline-latest.md)에 따로 보고합니다. 이 값은 편집 신호이지 작성자 판정이나 탐지기 우회 약속이 아닙니다.

## 설정

```yaml
# .patina.default.yaml
version: "4.0.0"
language: ko              # ko | en | zh | ja
profile: default
output: rewrite           # rewrite | diff | audit | score
tone:                     # casual | professional | academic | narrative | marketing | instructional | auto
```

패턴 팩은 언어 접두사로 자동 탐색됩니다. 작업 디렉토리의 `.patina.yaml` 이 기본값을 오버라이드합니다. 탐지를 확장하는 목록 키(`blocklist`, `allowlist`, `skip-patterns`)는 default/global/project 설정 사이에서 누적 병합(additively merge)되며, 다른 배열 값은 사용자가 정확한 값을 고를 수 있도록 대체됩니다.

## 문서

- **[Cookbook](docs/COOKBOOK.md)** — Hugo 배치 스코어링, GitHub Actions, 오탐 triage, 커스텀 프로필, pre-commit recipe
- **[Glossary](docs/GLOSSARY.md)** — MPS, fidelity, burstiness, MATTR, 모드 등 반복 용어의 짧은 정의
- **[Demo](docs/DEMO.md)** — 터미널 transcript와 여러 장르의 before/after 스냅샷
- **[Patterns](docs/PATTERNS.md)** — 168개 패턴 카탈로그
- **[Authentication](docs/AUTHENTICATION_KR.md)** ([English](docs/AUTHENTICATION.md)) — 백엔드, 프로바이더, 무료 티어 설정
- **[GitHub Action](docs/integrations/github-action.md)** — live model key 없이 PR hotspot comment와 README score badge 생성
- **[Pre-commit](docs/integrations/pre-commit.md)** — pre-commit, Husky, Lefthook score-only recipe
- **[Static-site Stencils](docs/integrations/static-sites.md)** — Hugo, Astro, Next.js MDX build-time scoring recipe
- **[Docker](docs/integrations/docker.md)** — GHCR image 사용법과 release tag
- **[Release workflow](docs/integrations/release.md)** — npm provenance + GHCR publishing checklist
- **[CLI Contract](docs/CLI.md)** — score gate, JSON/text/Markdown output, 자동화에 안전한 표면
- **[API Reference](docs/API.md)** — programmatic import와 scoring helper용 생성 JSDoc reference
- **[Flag Parity](docs/FLAG-PARITY.md)** — standalone CLI와 `/patina`의 옵션 지원 범위
- **[Exit Codes](docs/EXIT-CODES.md)** — CI와 editor integration용 process code contract
- **[Ethics](docs/ETHICS.md)** — 올바른 사용 목적, 금지 사용, disclosure 입장
- **[FAQ](docs/FAQ_KR.md)** ([English](docs/FAQ.md)) — detector-bypass 우려, MPS, 오탐, 기여 시작점
- **[False-positive Gallery](docs/FALSE-POSITIVES.md)** — 작성자 비난이 아니라 편집 힌트로 보아야 하는 register 예시
- **[Comparison](docs/COMPARISON.md)** — 일반 paraphraser/humanizer 도구와의 사실 기반 비교
- **[Branding](docs/BRANDING.md)** — canonical 로고/소셜 asset과 OG 설정 메모
- **[Design](DESIGN.md)** — repo-native SVG와 README surface의 제품/브랜드 기준
- **[Roadmap](docs/ROADMAP.md)** — 품질, 벤치마크, 제품, 커뮤니티, 런칭 우선순위
- **[Docs Platform RFC](docs/RESEARCH-DOCS-PLATFORM.md)** — Docusaurus, Astro Starlight, MkDocs, GitHub Pages 조사
- **[Benchmark Reports](docs/benchmarks/README.md)** — 체크인된 벤치마크 산출물, 갱신 명령, public-claim gate
- **[Benchmark Report](docs/benchmarks/latest.md)** — 최신 재현 가능 suspect-zone 벤치마크 요약
- **[Detector Comparison Harness](docs/benchmarks/detector-comparison.md)** — third-party detector를 오프라인/수동 비교하는 프로토콜
- **[AI/Human Metrics Research](docs/research/ai-human-metrics.md)** — AI-like writing signal 측정용 벤치마크 설계 메모
- **[2026 Modern-model Rebaseline](docs/research/2026-rebaseline.md)** — 현재 날짜가 찍힌 KO+EN catch/FP claim
- **[2025+ Re-baseline Plan](docs/research/2025-rebaseline-plan.md)** — 더 넓은 model-era claim 전 evidence gate
- **[zh/ja Lexicon Calibration](docs/research/zh-ja-lexicon-calibration.md)** — starter lexicon gate와 남은 corpus risk
- **[Launch Copy](docs/social/patina-launch-copy.md)** — launch sequence, score gate, Show HN/Product Hunt/Reddit/X/Korean drafts
- **[Signs of AI Writing](docs/social/signs-of-ai-writing_KR.md)** ([English](docs/social/signs-of-ai-writing.md)) — cited example이 붙은 공유용 편집 checklist
- **[Stylometry](core/stylometry.md)** — burstiness + MATTR + AI 어휘 알고리즘
- **[Scoring](core/scoring.md)** — AI 유사도 + 충실도 + MPS
- **[Changelog](CHANGELOG.md)** — 릴리스 노트와 방법론
- **[Examples](docs/EXAMPLES_KR.md)** ([English](docs/EXAMPLES.md)) — before/after 갤러리와 예시 fixture 안내
- **[Contributing](CONTRIBUTING_KR.md)** ([English](CONTRIBUTING.md)) — 패턴 제출, 오탐 triage, 벤치마크 fixture, 버전 관리
- **[Governance](GOVERNANCE.md)** / **[Maintainers](MAINTAINERS.md)** — 가벼운 프로젝트 의사결정 규칙

## 영감

[oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh) 플러그인 아키텍처 (패턴 = 플러그인, 프로필 = 테마), [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), [blader/humanizer](https://github.com/blader/humanizer).

## 라이선스

MIT
