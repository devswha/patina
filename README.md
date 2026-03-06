**[한국어](README_KR.md)** | English

# oh-my-humanizer

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code Skill](https://img.shields.io/badge/Claude%20Code-Skill-blueviolet)](https://docs.anthropic.com/en/docs/claude-code)
[![Based on](https://img.shields.io/badge/Based%20on-blader%2Fhumanizer-blue)](https://github.com/blader/humanizer)
[![Multi-language](https://img.shields.io/badge/Languages-Korean%20%7C%20English-green)](https://github.com/devswha/oh-my-humanizer)

**Make AI text sound like a human wrote it.**

A [Claude Code](https://docs.anthropic.com/en/docs/claude-code) skill that detects and removes AI writing patterns from Korean and English text. It finds the telltale signs -- the "delve into"s, the triple-item lists, the vague conclusions -- and rewrites them into natural prose.

> "LLMs use statistical algorithms to guess what should come next. The result tends toward the most statistically likely result that applies to the widest variety of cases." — [Wikipedia](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)

## See It In Action

**Before** (AI-sounding):
> AI coding tools represent a **groundbreaking milestone** showcasing the **innovative potential** of large language models, signifying a **pivotal turning point** in software development evolution. This not only streamlines processes but also fosters collaboration and facilitates organizational alignment.

**After** (humanized):
> AI coding tools speed up grunt work. Config files, test scaffolding, that kind of thing. The problem is the code looks right even when it isn't. It compiles, passes lint, so you merge it -- then find out later it's doing something completely different from what you intended.

52 patterns detected across Korean (28) and English (24). See the [full pattern list](#patterns) below.

## Install

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/devswha/oh-my-humanizer.git ~/.claude/skills/humanizer
```

That's it. Claude Code will detect the skill automatically.

## Use

In Claude Code, type:

```
/humanizer

[paste your text here]
```

Korean is the default language. For English:

```
/humanizer --lang en

[paste your English text here]
```

### More Options

| Flag | What it does |
|------|-------------|
| `--lang en` | Process English text instead of Korean |
| `--profile blog` | Use blog/essay writing style |
| `--diff` | Show what changed and why, pattern by pattern |
| `--audit` | Detect AI patterns only (no rewriting) |
| `--score` | Get an AI-similarity score from 0-100 |

Combine flags freely: `/humanizer --lang en --audit --profile blog`

## How It Works

```
Your text
  |
  v
[Phase 1] Structure scan -- fix paragraph-level issues (repetition, passive voice)
  |
  v
[Phase 2] Sentence rewrite -- fix word-level issues (AI vocabulary, filler, hedging)
  |
  v
[Phase 3] Self-audit -- "does this still sound like AI?" -- fix remaining issues
  |
  v
Natural-sounding text
```

The skill loads language-specific pattern packs (`ko-*.md` or `en-*.md`) and applies them through this 3-phase pipeline. Profiles and voice guidelines shape the tone.

## <a name="patterns"></a>Patterns

### Korean (28 patterns)

<details>
<summary><b>Structure Patterns</b> (Phase 1) -- 4 patterns for document-level issues</summary>

| # | Pattern | What AI does | Fix |
|---|---------|-------------|-----|
| 25 | Structural Repetition | Every paragraph follows the same claim-evidence-significance structure | Vary structures: question, detail, short punch |
| 26 | Translationese | Unnatural calques from English ("~It is a fact that") | Use natural Korean sentence forms |
| 27 | Passive Voice Overuse | Double passive constructions | Active voice or simple passive |
| 28 | Unnecessary Loanwords | "Leverage insights for synergy" | Native Korean equivalents |

</details>

<details>
<summary><b>Content Patterns</b> -- 6 patterns for substance issues</summary>

| # | Pattern | What AI does | Fix |
|---|---------|-------------|-----|
| 1 | Importance Inflation | "groundbreaking milestone", "pivotal turning point" | Replace with specific facts, dates, numbers |
| 2 | Media Mention Inflation | "featured in NYT, BBC, etc." | Cite one specific article |
| 3 | Superficial -ing Analysis | "showcasing, symbolizing, contributing" | Remove filler or add real sources |
| 4 | Promotional Language | "stunning natural beauty... gem of tourism" | Neutral description with facts |
| 5 | Vague Attributions | "experts say... industry insiders note" | Name the actual source |
| 6 | Formulaic Challenges/Prospects | "despite challenges... bright future" | Specific problems and concrete plans |

</details>

<details>
<summary><b>Language Patterns</b> -- 6 patterns for grammar/vocabulary issues</summary>

| # | Pattern | What AI does | Fix |
|---|---------|-------------|-----|
| 7 | AI Vocabulary Overuse | Korean AI filler words overused | Plain language, specific details |
| 8 | -jeok Suffix Overuse | Piles up Sino-Korean adjective suffixes | Describe what actually happened |
| 9 | Negative Parallelisms | "not just X but Y" as crutch | State the point directly |
| 10 | Rule of Three | Triple-item lists everywhere | Use the natural number of items |
| 11 | Synonym Cycling | Rotates synonyms for the same thing | Pick one term and stick with it |
| 12 | Verbose Particles | Unnecessarily long grammatical forms | Concise equivalents |

</details>

<details>
<summary><b>Style Patterns</b> -- 6 patterns for formatting issues</summary>

| # | Pattern | What AI does | Fix |
|---|---------|-------------|-----|
| 13 | Excessive Connectors | Korean transition word overuse | Cut unnecessary connectors |
| 14 | Boldface Overuse | Bolds every key term | Plain text |
| 15 | Inline-Header Lists | "**Label:** description" format | Convert to prose |
| 16 | Progressive Tense Overuse | Korean progressive form overuse | Past tense or specific plans |
| 17 | Emojis | Emoji section markers in professional text | Remove |
| 18 | Excessive Formal Language | Overly official register | Plain language |

</details>

<details>
<summary><b>Communication Patterns</b> -- 3 patterns for chatbot artifacts</summary>

| # | Pattern | What AI does | Fix |
|---|---------|-------------|-----|
| 19 | Chatbot Phrases | "Hope this helps! Let me know" | Remove entirely |
| 20 | Training Cutoff Disclaimers | "specific info is limited" | Find sources or remove |
| 21 | Sycophantic Tone | "Great question! Exactly right" | Respond directly |

</details>

<details>
<summary><b>Filler & Hedging Patterns</b> -- 3 patterns for padding</summary>

| # | Pattern | What AI does | Fix |
|---|---------|-------------|-----|
| 22 | Filler Phrases | Unnecessary padding words | Concise equivalents |
| 23 | Excessive Hedging | Over-qualified statements | Direct statements |
| 24 | Vague Positive Conclusions | "bright future ahead" | Specific plans or facts |

</details>

### English (24 patterns)

Ported from [blader/humanizer](https://github.com/blader/humanizer), based on [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing).

<details>
<summary><b>Content Patterns</b> -- 6 patterns</summary>

| # | Pattern | What AI does | Fix |
|---|---------|-------------|-----|
| 1 | Importance Inflation | "represents a significant milestone" | Specific facts |
| 2 | Media/Notability Inflation | "garnered significant attention" | Cite specific source |
| 3 | Superficial -ing Analysis | "showcasing, highlighting, underscoring" | Remove or add sources |
| 4 | Promotional Language | "stunning, world-class, hidden gem" | Neutral description |
| 5 | Vague Attributions | "experts say, studies show" | Name the source |
| 6 | Challenges and Prospects | "despite challenges... poised for growth" | Specific problems/plans |

</details>

<details>
<summary><b>Language Patterns</b> -- 6 patterns</summary>

| # | Pattern | What AI does | Fix |
|---|---------|-------------|-----|
| 7 | AI Vocabulary | "delve, tapestry, landscape, multifaceted" | Plain language |
| 8 | Copula Avoidance | "serves as, acts as, functions as" | Just use "is" |
| 9 | Negative Parallelisms | "not just X but Y" | State the point directly |
| 10 | Rule of Three | "X, Y, and Z" on repeat | Natural item count |
| 11 | Synonym Cycling | "the city... the metropolis... the urban center" | Pick one term |
| 12 | False Ranges | "from X to Y", "ranging from... to" | Specific values |

</details>

<details>
<summary><b>Style Patterns</b> -- 6 patterns</summary>

| # | Pattern | What AI does | Fix |
|---|---------|-------------|-----|
| 13 | Em Dash Overuse | "innovation -- a key driver -- transforms" | Reduce em dashes |
| 14 | Boldface Overuse | Bold terms scattered everywhere | Plain text |
| 15 | Inline-Header Lists | "**Label:** description" format | Convert to prose |
| 16 | Title Case Headings | "The Future Of Artificial Intelligence" | Sentence case |
| 17 | Emojis | Emoji section markers | Remove |
| 18 | Curly Quotation Marks | Smart quotes in plain text contexts | Straight quotes |

</details>

<details>
<summary><b>Communication Patterns</b> -- 3 patterns</summary>

| # | Pattern | What AI does | Fix |
|---|---------|-------------|-----|
| 19 | Chatbot Phrases | "I hope this helps! Let me know" | Remove entirely |
| 20 | Training Cutoff Disclaimers | "as of my last update" | Find sources or remove |
| 21 | Sycophantic Tone | "Great question!" | Respond directly |

</details>

<details>
<summary><b>Filler & Hedging Patterns</b> -- 3 patterns</summary>

| # | Pattern | What AI does | Fix |
|---|---------|-------------|-----|
| 22 | Filler Phrases | "it's important to note that" | Cut the filler |
| 23 | Excessive Hedging | "could potentially be argued that perhaps" | Direct statement |
| 24 | Vague Positive Conclusions | "a bright future lies ahead" | Specific facts |

</details>

<details>
<summary><b>Korean vs English: where patterns differ</b></summary>

Some patterns are language-specific. Where Korean has one pattern, English may have a different one in the same slot:

| # | Korean | English |
|---|--------|---------|
| 8 | -jeok suffix overuse (Sino-Korean adjectives) | Copula avoidance ("serves as") |
| 12 | Verbose particles (Korean grammar) | False ranges ("from X to Y") |
| 13 | Excessive connectors (Korean transitions) | Em dash overuse |
| 16 | Progressive tense overuse | Title Case in Headings |
| 18 | Excessive formal language | Curly quotation marks |
| 25-28 | Structure patterns (Korean-specific) | Placeholder (no English equivalents yet) |

</details>

## Configuration

Edit `.humanizer.default.yaml`:

```yaml
version: "3.0.0"
language: ko              # ko | en (or use --lang flag)
profile: default          # default | blog
output: rewrite           # rewrite | diff | audit | score
skip-patterns: []         # e.g., [ko-filler] to skip a pack
blocklist: []             # extra words to flag
allowlist: []             # words to never flag
```

Pattern packs are auto-discovered by language prefix -- no need to list them manually.

## Profiles

| Profile | Tone | Best for |
|---------|------|----------|
| `default` | Keeps original tone | General purpose |
| `blog` | More personal, opinionated | Blog posts, essays |

```
/humanizer --profile blog text...
```

## Custom Patterns

Drop a `.md` file into `custom/patterns/` and it's automatically loaded:

```markdown
---
pack: my-patterns
language: ko
name: My Custom Patterns
version: 1.0.0
patterns: 1
---

### 1. Pattern Name
**Problem:** What AI does wrong
**Before:** > AI-sounding example
**After:** > Natural-sounding fix
```

## Project Structure

```
oh-my-humanizer/
├── SKILL.md                  # Orchestrator (the "engine")
├── .humanizer.default.yaml   # Configuration
├── core/voice.md             # Voice & personality guidelines
├── patterns/
│   ├── ko-*.md               # Korean patterns (6 packs, 28 patterns)
│   └── en-*.md               # English patterns (6 packs, 24 patterns)
├── profiles/                 # Writing style profiles
├── examples/                 # Before/after test cases
└── custom/                   # Your extensions (gitignored)
```

Inspired by [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh)'s plugin architecture: patterns are plugins, profiles are themes.

## Adding a New Language

1. Create `patterns/{lang}-content.md`, `{lang}-language.md`, etc.
2. Set `language: {lang}` in each file's frontmatter
3. Use `/humanizer --lang {lang}` -- auto-discovered, no config changes needed

## References

- [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) -- primary source for patterns
- [WikiProject AI Cleanup](https://en.wikipedia.org/wiki/Wikipedia:WikiProject_AI_Cleanup) -- community effort
- [blader/humanizer](https://github.com/blader/humanizer) -- original English version

## Version History

| Version | Changes |
|---------|---------|
| **3.0.0** | Multi-language framework, `--lang` flag, English patterns (24) from blader/humanizer, skill renamed to `humanizer` |
| **2.2.0** | Loanword overuse pattern (#28), badges, repo rename |
| **2.1.0** | 2-Phase pipeline, structure patterns, blog profile, examples |
| **2.0.0** | Plugin architecture: pattern packs, profiles, config |
| **1.0.0** | Initial Korean adaptation (24 patterns) |

## License

MIT
