# oh-my-humanizer

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code Skill](https://img.shields.io/badge/Claude%20Code-Skill-blueviolet)](https://docs.anthropic.com/en/docs/claude-code)
[![Based on](https://img.shields.io/badge/Based%20on-blader%2Fhumanizer-blue)](https://github.com/blader/humanizer)
[![Multi-language](https://img.shields.io/badge/Languages-Korean%20%7C%20English-green)](https://github.com/devswha/oh-my-humanizer)

A Claude Code skill that removes signs of AI-generated writing from **Korean** and **English** text, making it sound natural and human-written.

Inspired by [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh)'s plugin architecture. Based on [blader/humanizer](https://github.com/blader/humanizer), with Korean-specific patterns and multi-language framework.

> **Key Insight from Wikipedia:** "LLMs use statistical algorithms to guess what should come next. The result tends toward the most statistically likely result that applies to the widest variety of cases."

## Architecture

```
oh-my-humanizer/
├── SKILL.md                      # Orchestrator (2-Phase pipeline: structure -> sentence -> audit)
├── .humanizer.default.yaml       # Default configuration (language, patterns, profile)
├── core/
│   └── voice.md                  # Voice & personality guidelines
├── patterns/                     # Pattern packs (like oh-my-zsh plugins/)
│   ├── ko-structure.md           # Korean structure patterns 25-28 (Phase 1)
│   ├── ko-content.md             # Korean content patterns 1-6
│   ├── ko-language.md            # Korean language/grammar patterns 7-12
│   ├── ko-style.md               # Korean style patterns 13-18
│   ├── ko-communication.md       # Korean communication patterns 19-21
│   ├── ko-filler.md              # Korean filler/hedging patterns 22-24
│   ├── en-structure.md           # English structure patterns (placeholder)
│   ├── en-content.md             # English content patterns 1-6
│   ├── en-language.md            # English language patterns 7-12
│   ├── en-style.md               # English style patterns 13-18
│   ├── en-communication.md       # English communication patterns 19-21
│   └── en-filler.md              # English filler/hedging patterns 22-24
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
| `plugins=(git docker)` | `language: ko` / `language: en` |
| `plugins/` | `patterns/` |
| `themes/` | `profiles/` |
| `custom/plugins/` | `custom/patterns/` |
| `ZSH_THEME="robbyrussell"` | `profile: blog` |

## Installation

### Recommended (clone directly into Claude Code skills directory)

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/devswha/oh-my-humanizer.git ~/.claude/skills/humanizer
```

### Manual install/update

```bash
mkdir -p ~/.claude/skills/humanizer
cp -r SKILL.md .humanizer.default.yaml core/ patterns/ profiles/ ~/.claude/skills/humanizer/
```

## Usage

In Claude Code, invoke the skill:

```
/humanizer

[paste your Korean text here]
```

### Language Selection

```
/humanizer 텍스트...                  # Korean (default)
/humanizer --lang en text...          # English
```

### Options

```
/humanizer --profile blog 텍스트...   # Use blog profile
/humanizer --diff 텍스트...            # Show changes per pattern
/humanizer --audit 텍스트...           # Detect only, no rewrite
/humanizer --score 텍스트...           # AI similarity score 0-100
/humanizer --lang en --audit text...  # Audit English text
```

## Configuration

Edit `.humanizer.default.yaml` to customize:

```yaml
version: "3.0.0"
language: ko              # ko (Korean, default) | en (English)
                          # Override with CLI: --lang en
profile: default
output: rewrite           # rewrite | diff | audit | score

# Pattern packs are auto-discovered via Glob patterns/{lang}-*.md
# The patterns list below documents the default language's packs.
patterns:
  - ko-structure
  - ko-content
  - ko-language
  - ko-style
  - ko-communication
  - ko-filler

skip-patterns: []         # Pattern packs to skip
blocklist: []             # Additional vocabulary to detect
allowlist: []             # Vocabulary to exclude from detection
```

### Auto-Discovery

Pattern loading uses auto-discovery: `Glob patterns/{lang}-*.md` finds all packs for the selected language. The `patterns` list in config is informational only. Use `skip-patterns` to exclude specific packs.

## Custom Patterns

Add your own pattern packs to `custom/patterns/`:

```markdown
---
pack: my-patterns
language: ko
name: My Custom Patterns
version: 1.0.0
patterns: 2
---

# My Custom Patterns

### 1. Pattern Name
**Problem:** ...
**Before:** ...
**After:** ...
```

Custom patterns are automatically loaded alongside built-in patterns for the matching language.

## Korean Patterns (28)

### Structure Patterns (Phase 1)

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 25 | **Structural Repetition** | Every paragraph: "claim->evidence->significance" | Vary paragraph structures |
| 26 | **Translationese** | "~It is a fact that", "~It is possible to" | Natural Korean equivalents |
| 27 | **Passive Voice Overuse** | Double passive constructions | Active voice or simple passive |
| 28 | **Unnecessary Loanwords** | "Leverage insights for synergy" | Native Korean equivalents |

### Content Patterns

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 1 | **Importance Inflation** | "groundbreaking milestone" | Specific facts with dates/numbers |
| 2 | **Media Mention Inflation** | "featured in NYT, BBC, etc." | Cite one specific article |
| 3 | **Superficial -ing Analysis** | "showcasing, symbolizing, contributing" | Remove or add real sources |
| 4 | **Promotional Language** | "stunning natural beauty... gem of tourism" | Neutral description with facts |
| 5 | **Vague Attributions** | "experts say... industry insiders note" | Name the specific source |
| 6 | **Formulaic Challenges/Prospects** | "despite challenges... bright future" | Specific problems and plans |

### Language Patterns

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 7 | **AI Vocabulary Overuse** | Korean AI filler words | Plain language, specific details |
| 8 | **-jeok Suffix Overuse** | "innovative, systematic, effective" | Describe what actually happened |
| 9 | **Negative Parallelisms** | "not just X but Y" | State the point directly |
| 10 | **Rule of Three** | "creativity, innovation, sustainability" | Natural number of items |
| 11 | **Synonym Cycling** | "the city... the region... the municipality" | Pick one term |
| 12 | **Verbose Particles** | Unnecessarily long grammatical forms | Concise equivalents |

### Style Patterns

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 13 | **Excessive Connectors** | Korean transition word overuse | Cut unnecessary connectors |
| 14 | **Boldface Overuse** | "**OKR**, **KPI**, **BSC**" | Plain text |
| 15 | **Inline-Header Lists** | "**Performance:** improved" | Convert to prose |
| 16 | **Progressive Tense Overuse** | Korean progressive form overuse | Past tense or specific plans |
| 17 | **Emojis** | Emoji section markers | Remove emojis |
| 18 | **Excessive Formal Language** | Overly official Korean | Plain language |

### Communication Patterns

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 19 | **Chatbot Phrases** | "Hope this helps! Let me know" | Remove entirely |
| 20 | **Training Cutoff Disclaimers** | "specific info is limited" | Find sources or remove |
| 21 | **Sycophantic Tone** | "Great question! Exactly right" | Respond directly |

### Filler and Hedging

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 22 | **Filler Phrases** | Unnecessary padding | Concise equivalents |
| 23 | **Excessive Hedging** | Over-qualified statements | Direct statements |
| 24 | **Vague Positive Conclusions** | "bright future ahead" | Specific plans or facts |

## English Patterns (24)

Ported from [blader/humanizer](https://github.com/blader/humanizer), based on [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing).

### Content Patterns

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 1 | **Importance Inflation** | "represents a significant milestone" | Specific facts |
| 2 | **Media/Notability Inflation** | "garnered significant attention" | Cite specific source |
| 3 | **Superficial -ing Analysis** | "showcasing, highlighting, underscoring" | Remove or add sources |
| 4 | **Promotional Language** | "stunning, world-class, hidden gem" | Neutral description |
| 5 | **Vague Attributions** | "experts say, studies show" | Name the source |
| 6 | **Challenges and Prospects** | "despite challenges... poised for growth" | Specific problems/plans |

### Language Patterns

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 7 | **AI Vocabulary** | "delve, tapestry, landscape, multifaceted" | Plain language |
| 8 | **Copula Avoidance** | "serves as, acts as, functions as" | Use "is" |
| 9 | **Negative Parallelisms** | "not just X but Y" | State the point directly |
| 10 | **Rule of Three** | "X, Y, and Z" repeated | Natural item count |
| 11 | **Synonym Cycling** | "the city... the metropolis... the urban center" | Pick one term |
| 12 | **False Ranges** | "from X to Y", "ranging from... to" | Specific values |

### Style Patterns

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 13 | **Em Dash Overuse** | "innovation -- a key driver -- transforms" | Reduce em dashes |
| 14 | **Boldface Overuse** | Bold terms as study guide | Plain text |
| 15 | **Inline-Header Lists** | "**Label:** description" | Convert to prose |
| 16 | **Title Case Headings** | "The Future Of Artificial Intelligence" | Sentence case |
| 17 | **Emojis** | Emoji section markers | Remove emojis |
| 18 | **Curly Quotation Marks** | Smart quotes in plain text | Straight quotes |

### Communication Patterns

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 19 | **Chatbot Phrases** | "I hope this helps! Let me know" | Remove entirely |
| 20 | **Training Cutoff Disclaimers** | "as of my last update" | Find sources or remove |
| 21 | **Sycophantic Tone** | "Great question!" | Respond directly |

### Filler and Hedging

| # | Pattern | Before | After |
|---|---------|--------|-------|
| 22 | **Filler Phrases** | "it's important to note that" | Cut the filler |
| 23 | **Excessive Hedging** | "could potentially be argued that perhaps" | Direct statement |
| 24 | **Vague Positive Conclusions** | "a bright future lies ahead" | Specific facts |

## Korean vs English Pattern Differences

The Korean and English pattern sets share the same categories but differ in language-specific patterns:

| # | Korean Pattern | English Equivalent |
|---|---|---|
| 8 | -jeok suffix overuse (Korean-specific) | Copula avoidance ("serves as") |
| 12 | Verbose particles (Korean grammar) | False ranges ("from X to Y") |
| 13 | Excessive connectors (Korean transitions) | Em dash overuse |
| 16 | Progressive tense overuse (Korean-specific) | Title Case in Headings |
| 18 | Excessive formal language (Korean registers) | Curly quotation marks |
| 25-28 | Structure patterns (Korean-specific) | No English structure patterns (placeholder) |

## Quick Example

**Before (AI-sounding Korean):**
> AI coding tools represent a groundbreaking milestone showcasing the innovative potential of large language models, signifying a pivotal turning point in software development evolution.

**After (Humanized Korean):**
> AI coding tools speed up grunt work. Config files, test scaffolding, that kind of thing. The problem is the code looks right even when it isn't.

See `SKILL.md` for the full example with draft -> audit -> final rewrite flow.

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
/humanizer --profile blog text...
```

## Examples

The `examples/` directory contains before/after test cases for select patterns:
- **Success cases**: Correct transformations demonstrating pattern detection
- **Failure cases**: Over-corrections or false positives showing pattern boundaries

See `examples/README.md` for the naming convention and index.

## Version History

- **3.0.0** - Multi-language framework: auto-discovery pattern loading, `--lang` flag, English patterns (24) ported from blader/humanizer, skill renamed from `humanizer-kr` to `humanizer`
- **2.2.0** - Added loanword overuse pattern (#28), README modernization with badges, repo rename to oh-my-humanizer
- **2.1.0** - 2-Phase pipeline (structure -> sentence -> audit), 3 new structure patterns (27 total), blog profile, examples directory, profile overrides
- **2.0.0** - Plugin architecture (oh-my-humanizer): pattern packs, profiles, config file, custom extensions
- **1.0.0** - Initial Korean adaptation with 24 patterns, Korean-specific examples, and audit pass

## License

MIT
