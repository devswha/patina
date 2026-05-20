한국어 | **[English](README.md)** | **[中文](README_ZH.md)** | **[日本語](README_JA.md)**

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Skill](https://img.shields.io/badge/Skill-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%20OpenCode-blueviolet)](#빠른-시작)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-3.11.0-blue)](CHANGELOG.md)

> **AI 포장만 벗기고, 의미는 그대로.**

patina는 한국어·영어·중국어·일본어 글에서 AI 냄새가 나는 패턴을 찾아, 원래 주장을 건드리지 않고 다듬습니다. [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex), [Cursor](https://cursor.sh), OpenCode 용 스킬로 쓰거나 독립형 Node.js CLI 로 실행할 수 있습니다.

블랙박스 패러프레이저가 아닙니다. patina는 **패턴 기반이고 감사 가능**해서, 무엇을 왜 바꿨는지와 원문의 주장이 보존됐는지를 보여줍니다.

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
| **편집 핫스팟 재현율** | 한국어 91% [84.0–95.4%] (n=100) / 영어 76% [66.7–83.3%] (n=100), binomial 95% CI |
| **오탐율** | 사람 글 register별 13–25% 점추정 범위 *(CI 아님; 백과사전체의 본질적 한계, [문서화](core/stylometry.md))* |
| **모드** | rewrite · audit · score · diff · ouroboros |
| **무료 사용** | 가능 — `codex` CLI 로그인 시 API 키 불필요 |
| **결정성** | 스코어링 공식은 결정적이지만 LLM severity 부여 단계는 ±8–10pt 변동 ([scoring.md §8](core/scoring.md)) |
| **라이선스** | MIT |

## 빠른 시작

### Claude Code 또는 Codex CLI 스킬로

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

설치 스크립트가 Claude Code, [Codex CLI](https://github.com/openai/codex), Cursor, OpenCode 에 한 번에 연결합니다. 체크아웃 전에 repository HEAD를 구체적인 commit으로 해석하므로, 완전히 고정된 설치가 필요하면 `PATINA_REF=<tag-or-full-sha>`를 설정하세요. 그런 다음:

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

link 후 stdin으로도 시험할 수 있습니다:

```bash
printf '%s\n' '커피는 전 세계의 사회적 상호작용을 근본적으로 바꾼 중요한 문화 현상으로 부상했다.' \
  | patina --lang ko --backend codex-cli
```

> 🆓 **API 키 없이 무료 사용 가능** — [`codex`](https://github.com/openai/codex), [`claude`](https://docs.anthropic.com/en/docs/claude-code), [`gemini`](https://github.com/google-gemini/gemini-cli) CLI 중 하나만 로그인되어 있으면 됩니다. `--backend codex-cli | claude-cli | gemini-cli` 로 직접 선택하거나 `--model claude-*` / `--model gemini-*` 처럼 모델명으로 라우팅됩니다. 전체 백엔드는 [AUTHENTICATION.md](docs/AUTHENTICATION.md) 참조.

### CI integrations

Patina는 live model key 없이도 prose review용 결정론적 CI 체크를 제공합니다:

```yaml
# .github/workflows/patina.yml
steps:
  - uses: actions/checkout@v6
  - uses: devswha/patina-action@main # npm publish + Action 태그 후 @v1 사용
    with:
      patina-package: github:devswha/patina # patina-cli@latest npm 공개 후 제거
      report-threshold: 30
      comment: true
```

Pre-commit, Husky, Lefthook, Docker, release workflow 메모는 [docs/integrations/](docs/integrations/)에 있습니다.

## 의도한 사용

Patina는 작성자가 AI 지원을 써도 되는 상황에서 AI 이후 편집, audit trail, voice cleanup을 돕는 도구입니다. 텍스트가 "원래 사람이 쓴 것"이라는 약속은 아니며, 학업 honor-code 회피, 출판사 disclosure 우회, 표절 세탁, detector-bypass 주장에 사용해서는 안 됩니다. [ETHICS.md](docs/ETHICS.md)를 참고하세요.

## 모드

```
patina --lang <ko|en|zh|ja> [모드] [--profile <이름>] input.txt
```

| 플래그 | 기능 |
|--------|------|
| *(기본)* | 재작성 |
| `--audit` | AI 패턴 탐지만 수행 |
| `--score` | 0–100 AI 유사도 점수 + 카테고리별 분석 |
| `--score --exit-on <n>` | CI를 엄격하게 유지: `overall > n`이면 종료 코드 `3` (`--gate`는 alias) |
| `--diff` | 변경 사항을 패턴별로 표시 |
| `--ouroboros` | 점수가 수렴할 때까지 반복 (MPS 롤백 포함) |
| `--lang <ko\|en\|zh\|ja>` | 언어 선택 (기본값: `ko`) |
| `--profile <이름>` | 톤 프리셋: `blog`, `academic`, `technical`, `formal`, `social`, `email`, `legal`, `medical`, `marketing`, `narrative`, `instructional`, `casual-conversation` |
| `--tone <이름>` | 톤 카테고리: `casual`, `professional`, `academic`, `narrative`, `marketing`, `instructional`, `auto` |
| `--batch` | 위치 인자를 파일 목록으로 처리 (예: `--batch docs/*.md`) |
| `--format json\|text\|markdown` | JSON, 일반 텍스트, 기본 Markdown 출력 선택 |
| `--prompt-mode strict\|minimal\|auto` | 전체 패턴 팩 프롬프트, 압축 프롬프트, 백엔드별 자동 선택 |
| `--variants <1-5>` | 사실과 의미 앵커를 유지한 여러 rewrite 변형 생성 |

전체 옵션은 `patina --help`.

### 스코어 전용 패턴

`--score`와 `--audit`는 `--rewrite`보다 약간 더 넓은 신호를 측정합니다. viral-hook 팩(`ko/en/zh/ja-viral-hook`, 각 5개 패턴: 숫자 충격 훅, 클릭베이트 종결, 출처 회피 권위 주장, 호흡 최적화 단문 배열, 과장된 참여 유도 어휘)은 **탐지 전용**입니다.

이 신호들은 score와 audit에만 나타나 네 언어의 SNS 마케팅 카피에 대한 사용자 직관과 벤치마크를 맞춥니다. `--rewrite`/`--diff`/`--ouroboros`는 이런 표현이 의도된 수사일 수 있어 건너뜁니다. 실제 데모: [`examples/viral-hook/`](examples/viral-hook/).

### 프롬프트 모드 튜닝 (v3.11)

`--prompt-mode strict|minimal|auto` 는 전체 패턴 팩(약 34KB 구조화 프롬프트)과 압축된 캐주얼 지시문(약 3KB) 사이의 균형을 선택합니다. `auto` 는 백엔드별로 선택합니다 — Gemini는 minimal에서 더 잘 동작하고(긴 구조화 프롬프트에 과도하게 제약됨), Claude는 전체 팩을 활용하며, Codex는 대체로 차이가 작습니다. case-05가 A/B 결과를 문서화합니다.

### 여러 스타일 변형 (v3.11)

`--variants <1-5>` 는 한 번의 호출에서 N개의 보이스 변형을 요청합니다(예: V1 캐주얼, V2 직설적, V3 절제됨). 사실, 수치, 인과관계는 모든 변형에서 동일하게 유지됩니다. 각 결과는 `## Variant N` 형식으로 돌아오므로 원하는 보이스를 고를 수 있습니다.

### 짧은 텍스트 점수 보정 (v3.11)

입력이 200자 이하이거나 3문단 이하이면 레지스터에 민감한 카테고리(`language`, `style`, `viral-hook`)에 1.5배 severity multiplier를 적용해 단일 문단의 보이스 변화도 점수에 드러나게 합니다. case-04에서 긴 글 기준 공식이 이런 신호를 과소계산한다는 점을 확인했습니다.

### 자기검수 분리 (v3.11)

rewrite 모드에서 모델은 `[BODY]`/`[/BODY]` 블록(또는 `--variants > 1`일 때 `[VARIANT n]` 블록)을 감싸는 `[SELF_AUDIT]`/`[/SELF_AUDIT]` 태그 안에 자기검수 메모를 냅니다. patina는 사용자에게 보여주기 전에 audit을 제거하므로 원시 출력이 깔끔합니다 — 이전 버전에서는 "남아 있는 AI 티"나 "Phase 3" 같은 프리앰블이 사용자-facing 텍스트에 새어 나오는 경우가 있었습니다.

### Machine-readable output and exit codes

`--format json`은 모든 모드를 `overall`, `categories[]`, `tone`, `mps`, `gateResult`, 정리된 `output` 본문을 담은 안정적인 envelope로 감쌉니다. `--format markdown`이 기본값이고, `--format text`는 YAML tone footer 없는 사용자-facing 본문만 유지합니다. 종료 코드는 [EXIT-CODES.md](docs/EXIT-CODES.md)에 정리되어 있습니다: `0` 성공, `1` runtime/backend, `2` input/usage, `3` score gate 초과, `4` MAX MPS fallback/all-candidates-failed.

### 점수 가중치 드리프트 감지 (v3.11)

`--score` 실행은 모델이 출력한 Weight 열을 설정의 `category-weights`와 교차 확인합니다. 모델이 존재하지 않는 카테고리(예: `discord`)를 만들거나 다른 숫자로 바꾸면 `[patina]` 경고가 stderr에 출력됩니다 — 관측용일 뿐 점수 자체는 바꾸지 않습니다.

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

**캘리브레이션** *(500단락 코퍼스, `.omc/research/v3_8_remeasure.py` 로 재현 가능)*: HC3 ChatGPT (en) 편집 핫스팟 재현율 76% [66.7–83.3%], paired ko/AI 코퍼스 91% [84.0–95.4%] (각 n=100, binomial 95% CI). 사람 글 오탐은 register별 13–25% 점추정 범위로 별도 보고합니다. 수용 기준: AI ≥ 75%, 최대 FP ≤ 25%. 알고리즘은 [stylometry.md](core/stylometry.md).

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

패턴 팩은 언어 접두사로 자동 탐색됩니다. 작업 디렉토리의 `.patina.yaml` 이 기본값을 오버라이드합니다. 탐지를 확장하는 목록 키(`blocklist`, `allowlist`, `skip-patterns`)는 default/global/project 설정 사이에서 추가 병합되고, `max-models` 같은 provider 목록은 사용자가 정확한 백엔드 세트를 선택할 수 있도록 대체됩니다.

## 문서

- **[Glossary](docs/GLOSSARY.md)** — MPS, fidelity, burstiness, MATTR, 모드 등 반복 용어의 짧은 정의
- **[Demo](docs/DEMO.md)** — 터미널 transcript와 여러 장르의 before/after 스냅샷
- **[Patterns](docs/PATTERNS.md)** — 146개 패턴 카탈로그
- **[Authentication](docs/AUTHENTICATION.md)** — 백엔드, 프로바이더, 무료 티어 설정
- **[CLI Contract](docs/CLI.md)** — score gate, exit code, 자동화에 안전한 표면
- **[Flag Parity](docs/FLAG-PARITY.md)** — standalone CLI, `/patina`, `/patina-max` 옵션 지원 범위
- **[Ethics](docs/ETHICS.md)** — 의도한 사용, 금지 사용, disclosure 입장
- **[FAQ](docs/FAQ.md)** — detector-bypass 우려, MPS, 오탐, 기여 시작점
- **[Comparison](docs/COMPARISON.md)** — 일반 paraphraser/humanizer 도구와의 사실 기반 비교
- **[Branding](docs/BRANDING.md)** — canonical 로고/소셜 asset과 OG 설정 메모
- **[Design](DESIGN.md)** — repo-native SVG와 README surface의 제품/브랜드 기준
- **[Roadmap](docs/ROADMAP.md)** — 품질, 벤치마크, 제품, 커뮤니티, 런칭 우선순위
- **[Benchmark Report](docs/benchmarks/latest.md)** — 최신 재현 가능 suspect-zone 벤치마크 요약
- **[AI/Human Metrics Research](docs/research/ai-human-metrics.md)** — AI-like writing signal 측정용 벤치마크 설계 메모
- **[Launch Copy](docs/social/patina-launch-copy.md)** — Show HN, Reddit, X, 한국 커뮤니티 초안
- **[Stylometry](core/stylometry.md)** — burstiness + MATTR + AI 어휘 알고리즘
- **[Scoring](core/scoring.md)** — AI 유사도 + 충실도 + MPS
- **[Changelog](CHANGELOG.md)** — 릴리스 노트와 방법론
- **[Contributing](CONTRIBUTING.md)** — 패턴 제출, 오탐 triage, 벤치마크 fixture, 버전 관리
- **[Governance](GOVERNANCE.md)** / **[Maintainers](MAINTAINERS.md)** — 가벼운 프로젝트 의사결정 규칙

## 영감

[oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh) 플러그인 아키텍처 (패턴 = 플러그인, 프로필 = 테마), [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), [blader/humanizer](https://github.com/blader/humanizer).

## 라이선스

MIT
