# oh-my-humanizer

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code Skill](https://img.shields.io/badge/Claude%20Code-Skill-blueviolet)](https://docs.anthropic.com/en/docs/claude-code)
[![Based on](https://img.shields.io/badge/Based%20on-blader%2Fhumanizer%20v2.2.0-blue)](https://github.com/blader/humanizer)
[![Korean](https://img.shields.io/badge/Language-Korean-red)](https://github.com/devswha/oh-my-humanizer)

A Claude Code skill that removes signs of AI-generated writing from **Korean** text, making it sound natural and human-written.

Inspired by [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh)'s plugin architecture. Based on [blader/humanizer](https://github.com/blader/humanizer) (English version), adapted for Korean language patterns.

> **Key Insight from Wikipedia:** "LLMs use statistical algorithms to guess what should come next. The result tends toward the most statistically likely result that applies to the widest variety of cases."

## Architecture

```
oh-my-humanizer/
├── SKILL.md                      # Orchestrator (2-Phase pipeline: structure → sentence → audit)
├── .humanizer.default.yaml       # Default configuration
├── core/
│   └── voice.md                  # Voice & personality guidelines
├── patterns/                     # Pattern packs (like oh-my-zsh plugins/)
│   ├── ko-structure.md           # Structure patterns 25-28 (Phase 1)
│   ├── ko-content.md             # Content patterns 1-6
│   ├── ko-language.md            # Language/grammar patterns 7-12
│   ├── ko-style.md               # Style patterns 13-18
│   ├── ko-communication.md       # Communication patterns 19-21
│   └── ko-filler.md              # Filler/hedging patterns 22-24
├── profiles/                     # Writing style profiles (like oh-my-zsh themes/)
│   ├── default.md                # Default profile
│   └── blog.md                   # Blog/essay profile (pilot)
├── examples/                     # Before/after examples per pattern (success + failure cases)
└── custom/                       # User extensions (.gitignore'd)
    ├── patterns/                 # Custom pattern packs
    └── profiles/                 # Custom profiles
```

| oh-my-zsh | oh-my-humanizer |
|-----------|-----------------|
| `.zshrc` | `.humanizer.default.yaml` |
| `plugins=(git docker)` | `patterns: [ko-content, ko-style]` |
| `plugins/` | `patterns/` |
| `themes/` | `profiles/` |
| `custom/plugins/` | `custom/patterns/` |
| `ZSH_THEME="robbyrussell"` | `profile: blog` |

## Installation

### Recommended (clone directly into Claude Code skills directory)

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/devswha/oh-my-humanizer.git ~/.claude/skills/humanizer-kr
```

### Manual install/update

```bash
mkdir -p ~/.claude/skills/humanizer-kr
cp -r SKILL.md .humanizer.default.yaml core/ patterns/ profiles/ ~/.claude/skills/humanizer-kr/
```

## Usage

In Claude Code, invoke the skill:

```
/humanizer-kr

[paste your Korean text here]
```

### Options

```
/humanizer-kr --profile blog 텍스트...     # Use blog profile
/humanizer-kr --diff 텍스트...              # Show changes per pattern
/humanizer-kr --audit 텍스트...             # Detect only, no rewrite
/humanizer-kr --score 텍스트...             # AI similarity score 0-100
```

## Configuration

Edit `.humanizer.default.yaml` to customize:

```yaml
version: "2.2.0"
language: ko
profile: default
output: rewrite       # rewrite | diff | audit | score

patterns:
  - ko-structure
  - ko-content
  - ko-language
  - ko-style
  - ko-communication
  - ko-filler

skip-patterns: []     # Pattern packs to skip
blocklist: []         # Additional vocabulary to detect
allowlist: []         # Vocabulary to exclude from detection
```

## Custom Patterns

Add your own pattern packs to `custom/patterns/`:

```markdown
---
pack: my-patterns
language: ko
name: 내 커스텀 패턴
version: 1.0.0
patterns: 2
---

# 내 커스텀 패턴

### 1. 패턴 이름
**문제:** ...
**수정 전:** ...
**수정 후:** ...
```

Custom patterns are automatically loaded alongside built-in patterns.

## 28 Patterns Detected

### Structure Patterns (Phase 1)

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 25 | **구조적 반복** | Every paragraph: "주장→근거→의의" same structure | Vary paragraph structures (question, detail, short punch) |
| 26 | **번역체** | "~것은 사실이다", "~하는 것이 가능하다" | Natural Korean equivalents |
| 27 | **수동태 남용** | "~되어지다", "~되어질 수 있다" | Active voice or simple "~되다" |
| 28 | **불필요한 외래어** | "인사이트를 레버리지하여 시너지를" | "교훈을 활용해서 협력 효과를" |

### Content Patterns

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 1 | **과도한 중요성 부여** | "획기적인 전환점을 의미한다" | Specific facts with dates/numbers |
| 2 | **과도한 주목도/미디어 언급** | "뉴욕타임스, BBC 등에서 주목" | Cite one specific article with context |
| 3 | **~하며/~하고 피상적 분석** | "보여주며, 상징하고, 기여하며" | Remove or add real sources |
| 4 | **홍보성/광고성 언어** | "수려한 자연경관... 관광의 보석" | Neutral description with facts |
| 5 | **모호한 출처 인용** | "전문가들은... 업계 관계자에 따르면" | Name the specific source |
| 6 | **틀에 박힌 "과제와 전망"** | "과제에도 불구하고... 밝은 미래" | Specific problems and concrete plans |

### Language Patterns

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 7 | **AI 특유 어휘 남발** | "아울러, 다양한 혁신적인... 이를 통해" | Plain language, specific details |
| 8 | **~적(的) 접미사 남발** | "혁신적이고 체계적인... 효과적이고" | Describe what actually happened |
| 9 | **부정 병렬구조** | "~에 그치지 않고", "~뿐만 아니라" | State the point directly |
| 10 | **3의 법칙 남발** | "창의성, 혁신성, 그리고 지속가능성" | Use natural number of items |
| 11 | **유의어 순환** | "이 도시... 이 지역... 해당 지자체... 이곳" | Pick one term and stick with it |
| 12 | **장황한 조사 사용** | "~에 있어서", "~함에 있어" | "~에서", "~하려면" |

### Style Patterns

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 13 | **과도한 연결 표현** | "이를 통해... 이러한 점에서... 한편" | Cut unnecessary connectors |
| 14 | **볼드체 남발** | "**OKR**, **KPI**, **BSC**" | "OKR, KPI, BSC" |
| 15 | **인라인 헤더 목록** | "**성능:** 성능이 향상되었습니다" | Convert to prose |
| 16 | **~고 있다 진행형 남발** | "개척하고 있으며, 추진하고 있고" | Use past tense or plans |
| 17 | **이모지** | "🚀 출시 단계: 💡 핵심 인사이트:" | Remove emojis |
| 18 | **과도한 한자어/공식어** | "복리 증진을 도모하기 위한" | "생활을 개선하려는" |

### Communication Patterns

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 19 | **챗봇 표현** | "도움이 되셨으면! 말씀해 주세요" | Remove entirely |
| 20 | **학습 데이터 기한 면책** | "구체적인 정보는 제한적이나" | Find sources or remove |
| 21 | **아첨하는 말투** | "좋은 질문이십니다! 정확하게 짚어주셨는데요" | Respond directly |

### Filler and Hedging

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 22 | **채움 표현** | "~하기 위해서는", "~라는 사실에 기인하여" | "~하려면", "~때문에" |
| 23 | **과도한 헤징** | "~일 수 있을 것으로 판단될 수도" | "~일 수 있다" |
| 24 | **막연한 긍정적 결론** | "밝은 미래가 기대된다" | Specific plans or facts |

## Differences from English Version

This Korean adaptation differs from the [original English version](https://github.com/blader/humanizer) in several ways:

| # | English Pattern (removed) | Korean Replacement |
|---|---|---|
| 8 | Copula avoidance ("serves as") | **~적 접미사 남발** (혁신적, 체계적...) |
| 12 | False ranges ("from X to Y") | **장황한 조사** (~에 있어서, ~함에 있어) |
| 13 | Em dash overuse | **과도한 연결 표현** (이를 통해, 이러한 점에서...) |
| 16 | Title Case in Headings | **~고 있다 진행형 남발** (Korean-specific) |
| 18 | Curly quotation marks | **과도한 한자어/공식어** (도모하다, 기하다...) |

All examples are written in Korean with realistic before/after pairs.

## Quick Example

**Before (AI-sounding):**
> AI 코딩 도구는 대규모 언어 모델의 혁신적인 잠재력을 보여주는 핵심적인 이정표로서, 소프트웨어 개발의 진화에 있어 획기적인 전환점을 의미한다. 이를 통해 달성되는 핵심적인 가치는 명확하다: 프로세스의 효율화, 협업의 강화, 그리고 조직 정렬의 촉진.

**After (Humanized):**
> AI 코딩 도구, 잡일은 빨라진다. 설정 파일이나 테스트 뼈대 같은 거. 근데 맞는 것처럼 보이는 게 문제다. 컴파일되고 린트 통과하길래 넘겼는데 나중에 보니 완전 엉뚱한 동작을 하고 있었다.

See `SKILL.md` for the full example with draft → audit → final rewrite flow.

## References

- [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) - Primary source
- [WikiProject AI Cleanup](https://en.wikipedia.org/wiki/Wikipedia:WikiProject_AI_Cleanup) - Maintaining organization
- [blader/humanizer](https://github.com/blader/humanizer) - Original English version

## Profiles

| Profile | Description | Use Case |
|---------|-------------|----------|
| `default` | Maintain original tone, equal pattern priority | General purpose |
| `blog` | Amplify 1st person, opinions, rhythm variation; suppress bold/emoji tolerance | Personal blogs, essays |

Profiles support `voice-overrides` and `pattern-overrides` in YAML frontmatter for fine-grained control.

```
/humanizer-kr --profile blog 텍스트...
```

## Examples

The `examples/` directory contains before/after test cases for select patterns:
- **Success cases**: Correct transformations demonstrating pattern detection
- **Failure cases**: Over-corrections or false positives showing pattern boundaries

See `examples/README.md` for the naming convention and index.

## Version History

- **2.2.0** - Added loanword overuse pattern (#28), README modernization with badges, repo rename to oh-my-humanizer
- **2.1.0** - 2-Phase pipeline (structure → sentence → audit), 3 new structure patterns (27 total), blog profile, examples directory, profile overrides
- **2.0.0** - Plugin architecture (oh-my-humanizer): pattern packs, profiles, config file, custom extensions
- **1.0.0** - Initial Korean adaptation with 24 patterns, Korean-specific examples, and audit pass

## License

MIT
