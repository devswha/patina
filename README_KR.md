한국어 | **[English](README.md)** | **[中文](README_ZH.md)** | **[日本語](README_JA.md)**

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Skill](https://img.shields.io/badge/Skill-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%20OpenCode-blueviolet)](#빠른-시작)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-8.5.2-blue)](CHANGELOG.md)

<p align="center">
  <a href="https://patina.vibetip.help/?lang=ko&amp;utm_source=github&amp;utm_campaign=multilingual-20260907"><b>브라우저에서 바로 써보기 — 설치 없음</b></a>
</p>

> **AI 포장만 벗기고, 의미는 그대로.**

patina는 한국어·영어·중국어·일본어를 위한 결정론적 패턴 기반 휴머나이저입니다. AI가 쓴 듯한 표현을 찾아내고, 원문의 주장·수치·극성·인과관계를 바꾸지 않은 채 문장만 다시 씁니다.

블랙박스형 패러프레이저도, 작성자 판별기도, 탐지기 우회 도구도 아닙니다. patina는 AI 도움을 받아도 되는 상황에서 초안을 다듬으려는 작성자를 위한 도구입니다 — 더 깔끔한 문체, 감사 추적, 그리고 의미 보존 검사를 원하는 경우에 맞춰져 있습니다.

편집기 연동: [VS Code, Obsidian 및 Gmail 미리보기](docs/integrations/editors.md).

[모델 선택 가이드](docs/research/model-guide-20260905.md)와 [실제 채점 분포](docs/benchmarks/live-rebaseline-20260905.md)에서 검증 결과와 한계를 확인할 수 있습니다.

## 데모

한국어 회의 안내를 다듬은 **설명용 가상 예시**입니다. 실제 실행이나 측정 결과가 아닙니다. [전체 예시](playground/examples/ko.js)의 `ko-email-meeting`에서 발췌했습니다.

**수정 전**

> 회의 안건과 참석자에는 변동사항이 없습니다. 변경된 일정에 참석이 어려우신 경우, 9월 9일 오후 5시까지 회신해 주시면 감사하겠습니다.

**수정 후**

> 안건과 참석자는 그대로입니다. 바뀐 일정에 참석하기 어려우시면 9월 9일 오후 5시까지 답장 부탁드립니다.

안건·참석자와 회신 기한을 남겼습니다. 참석이 어려울 때 답장해 달라는 요청도 그대로입니다.

직접 실행하려면 **[playground](https://patina.vibetip.help/?lang=ko&utm_source=github&utm_campaign=multilingual-20260907)** 에 글을 붙여 넣으세요. 더 많은 [Before/After 예시](docs/EXAMPLES_KR.md)도 볼 수 있습니다.

- **블랙박스가 아닌, 감사 가능한 도구** — 184개의 이름 붙은 패턴이 모든 수정을 결정하고, `--diff`가 무엇이 왜 바뀌었는지 그대로 보여줍니다.
- **의미는 웹에서 검증됩니다** — playground는 모든 재작성을 MPS·충실도 하한으로 검증하고, 어긋난 결과는 거부합니다. Node CLI는 `--verify`, 에이전트 스킬은 `/patina --strict`로 같은 검사를 켭니다.
- **서로 독립적인 세 축** — Document Type은 장르를, Persona는 목소리를, Register는 전달 방식을 정합니다. 생략한 축은 원문이 유지됩니다.
- **모든 채널에서** — 에이전트 스킬(Claude Code · Codex · Cursor · OpenCode), Node CLI, [브라우저 playground](https://patina.vibetip.help/?lang=ko&utm_source=github&utm_campaign=multilingual-20260907).
- **한계에 정직하게** — 점수는 편집 신호이지 작성자 판정이 아니며, [사전 등록 연구](docs/research/2026-rewrite-efficacy-study1.md)에서 실패 지점까지 함께 공개합니다.

## 빠른 시작

**브라우저 — 설치 없음.** **[patina.vibetip.help](https://patina.vibetip.help/?lang=ko&utm_source=github&utm_campaign=multilingual-20260907)** 를 열고 붙여넣으면 끝. 재작성과 채점은 서버에서 실행되고, API 모드는 개인 키를 요청 단위로만 전달합니다(저장·로깅 없음).

[Hosted API (Pro)](docs/HTTP-API.md)

**에이전트 스킬 — Claude Code, Codex CLI, Cursor 등 아무 에이전트에나 붙여넣으세요:**

```text
Install patina by following https://raw.githubusercontent.com/devswha/patina/main/INSTALLATION.md
```

설치 후:

```text
/patina --lang ko

[여기에 글을 붙여넣으세요]
```

**CLI — Node 18.1 이상:**

```bash
npx patina-cli --lang ko input.txt          # 재작성
npx patina-cli doctor                       # 백엔드·키 상태 점검
```

로그인된 CLI가 있으면 API 키 없이 사용할 수 있습니다. 해당 CLI에 맞춰 `--backend codex-cli`, `--backend claude-cli`, `--backend gemini-cli`를 선택하세요. 전체 설치 옵션: [INSTALLATION.md](INSTALLATION.md).

## 서로 독립적인 세 축

patina는 한 축에서 다른 축을 추론하지 않습니다. Persona와 Register를 생략하면 원문의 목소리와 레지스터를 보존합니다.

| 축 | 정하는 것 | 정하지 않는 것 | 선택 방법 |
|---|---|---|---|
| **Document Type** | 장르·용도·구조 관습·패턴 정책 | 목소리, casual/professional 전달 방식, 의미 보존 하한 | `--document-type` · 설정 `document-type` · Playground "Document Type" |
| **Persona** | 재사용 보이스 지문: 어휘·리듬·설명 습관 | 장르, 패턴 정책, Register, 의미 보존 하한 | `--persona` · 설정 `persona` · Playground "Persona" |
| **Register** | `casual` 또는 `professional` 전달 방식 | 장르, Persona 정체성, 패턴 정책 | `--register` · 설정 `register` · Playground "Register" |

의미 보존은 세 축 바깥의 공통 하한이며, 명시된 한 축이 생략된 다른 축을 채우지 않습니다.

```bash
patina --document-type email --register professional note.md
patina --document-type blog --persona pragmatic-founder post.md
```

## 자주 쓰는 명령

```bash
patina input.txt                                          # 기본값으로 재작성
patina --audit input.txt                                  # 패턴 탐지만
patina --score --offline --exit-on 30 input.txt           # API 키 없는 결정론적 CI 게이트
patina --diff input.txt                                   # 패턴별 변경 표시
patina --verify input.txt                                 # 재작성 + MPS/충실도 하한 검사
patina --document-type email --register professional input.txt
patina persona new my-voice --from-sample past-posts.txt  # 내 글에서 보이스 학습
patina --persona my-voice draft.md
patina --batch docs/*.md --outdir cleaned/
```

`patina --help`가 전체 플래그를 출력합니다. GitHub Actions용 래퍼: [devswha/patina-action](https://github.com/devswha/patina-action) · [pre-commit 등 통합](docs/integrations/pre-commit.md).

프로젝트 설정은 `.patina.yaml`에 둡니다:

```yaml
# .patina.default.yaml
version: "8.5.2"
language: ko              # ko | en | zh | ja
document-type: default    # 장르·용도 + 패턴 정책
persona:                  # 선택 사항; 생략하면 원문 보이스 보존
register:                 # casual | professional; 생략하면 원문 레지스터 보존
```

## 한눈에 보기

|  |  |
|---|---|
| **184개 패턴** | 언어별 재작성 가능 37개 + 스코어 전용 바이럴 훅 9개(KO/EN/ZH/JA 각각 46개) — 전체 184개 패턴 카탈로그는 [PATTERNS.md](docs/PATTERNS.md) 참고 |
| **모드** | rewrite · verify · audit · score · diff |
| **캘리브레이션** | GPT-5.5 / Claude Sonnet 4.6 / Gemini 2.5 Pro 기준 편집 핫스팟 catch 67.3% [63.5–71.0%] (n=600, KO+EN); KO+EN 사람 글 컨트롤에서 오탐 16.0% [11.6–21.7%] (n=200) |
| **라이선스** | MIT |

점수는 오탐과 미탐이 있는 편집 신호이지 작성자 판정의 근거가 아닙니다. [Ethics](docs/ETHICS.md)를 참고하세요.

## 문서

- [Cookbook](docs/COOKBOOK.md) — 자주 쓰는 레시피 · [CLI 계약](docs/CLI.md) — 플래그·게이트·종료 코드
- [Before/After 갤러리](docs/EXAMPLES_KR.md) ([English](docs/EXAMPLES.md)) · [패턴 카탈로그](docs/PATTERNS.md)
- [아키텍처](docs/ARCHITECTURE.md) · [설정과 인증](docs/AUTHENTICATION_KR.md) ([English](docs/AUTHENTICATION.md))
- [CLI 실행 기록](docs/DEMO.md) — 위 가상 예시와 별개의 과거 자료
- [벤치마크](docs/benchmarks/latest.md) · [연구](docs/research/2026-rewrite-efficacy-study1.md) · [FAQ](docs/FAQ_KR.md) ([English](docs/FAQ.md))
- [기여 가이드](CONTRIBUTING_KR.md) ([English](CONTRIBUTING.md)) · [체인지로그](CHANGELOG.md)

<details>
<summary>이전 영문 playground 실행 녹화</summary>

위 한국어 가상 예시와 별개의 과거 실행 기록입니다.

<img src="https://raw.githubusercontent.com/devswha/patina/main/assets/demo/patina-playground-en.gif" alt="과거 영문 playground 실행 녹화. 위 한국어 설명용 예시와는 별개의 기록입니다." width="820">

</details>

## 라이선스

MIT. [LICENSE](LICENSE)와 [NOTICE](NOTICE)를 참고하세요. [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh), [Wikipedia의 "Signs of AI writing"](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), [blader/humanizer](https://github.com/blader/humanizer)에서 영감을 받았습니다.
