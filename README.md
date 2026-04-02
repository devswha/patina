**[한국어](README_KR.md)** | **[中文](README_ZH.md)** | **[日本語](README_JA.md)** | English

# patina

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code Skill](https://img.shields.io/badge/Claude%20Code-Skill-blueviolet)](https://docs.anthropic.com/en/docs/claude-code)
[![Based on](https://img.shields.io/badge/Based%20on-blader%2Fhumanizer-blue)](https://github.com/blader/humanizer)
[![Multi-language](https://img.shields.io/badge/Languages-Korean%20%7C%20English%20%7C%20Chinese%20%7C%20Japanese-green)](https://github.com/devswha/patina)

**Make AI text sound like a human wrote it.**

A [Claude Code](https://docs.anthropic.com/en/docs/claude-code) skill that detects and removes AI writing patterns from Korean, English, Chinese, and Japanese text. It finds the telltale signs -- the "delve into"s, the triple-item lists, the vague conclusions -- and rewrites them into natural prose.

> "LLMs use statistical algorithms to guess what should come next. The result tends toward the most statistically likely result that applies to the widest variety of cases." — [Wikipedia](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)

## See It In Action

**Before** (AI-sounding):
> AI coding tools represent a **groundbreaking milestone** showcasing the **innovative potential** of large language models, signifying a **pivotal turning point** in software development evolution. This not only streamlines processes but also fosters collaboration and facilitates organizational alignment.

**After** (humanized):
> AI coding tools speed up grunt work. Config files, test scaffolding, that kind of thing. The problem is the code looks right even when it isn't. It compiles, passes lint, so you merge it -- then find out later it's doing something completely different from what you intended.

112 patterns detected across Korean (28), English (28), Chinese (28), and Japanese (28). See the [full pattern list](#patterns) below.

## Install

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/devswha/patina.git ~/.claude/skills/patina

# Expose the MAX variant as its own Claude skill
ln -snf ~/.claude/skills/patina/patina-max ~/.claude/skills/patina-max
```

Claude Code will detect `/patina` automatically. Add the symlink step as well if you want `/patina-max` exposed as a separate skill.

### Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

This handles everything: creates the skills directory, clones the repo, and sets up the patina-max symlink. Safe to run again to update.

## Use

In Claude Code, type:

```
/patina

[paste your text here]
```

Korean is the default language. For other languages:

```
/patina --lang en

[paste your English text here]
```

```
/patina --lang zh

[paste your Chinese text here]
```

```
/patina --lang ja

[paste your Japanese text here]
```

### More Options

| Flag | What it does |
|------|-------------|
| `--lang en` | Process English text |
| `--lang zh` | Process Chinese text |
| `--lang ja` | Process Japanese text |
| `--batch docs/*.md` | Process multiple files at once |
| `--in-place` | Overwrite originals (with `--batch`) |
| `--suffix .humanized` | Save as `{file}.humanized.md` |
| `--outdir output/` | Save results to a directory |
| `--profile blog` | Use blog/essay writing style |
| `--profile formal` | Use formal document style (CVs, resumes, proposals) |
| `--diff` | Show what changed and why, pattern by pattern |
| `--audit` | Detect AI patterns only (no rewriting) |
| `--score` | Get an AI-similarity score from 0-100 |
| `--ouroboros` | Iterative self-improvement: rewrite until AI score converges |

Combine flags freely: `/patina --lang en --audit --profile blog` or `/patina --profile formal`

### MAX Mode (Multi-Model)

Run the same text through multiple AI models and pick the best result:

```
/patina-max

[paste your text here]
```

Each model humanizes independently, results are scored for AI-likeness, and the lowest-scoring (most human) result wins.

| Flag | What it does |
|------|-------------|
| `--models claude,gemini` | Choose which models to use |
| `--lang en` | Process English text |
| `--profile blog` | Use blog/essay writing style |

Supported models: `claude`, `codex`, `gemini`. MAX mode feeds all three via stdin (`claude -p`, `gemini -p '' --output-format text`, `codex exec --skip-git-repo-check`) and captures Codex's final answer with `--output-last-message`.

Each MAX run uses a unique temp directory, waits only for the models you selected, and marks timed-out runs as failed instead of waiting forever.

### Score Mode

Check how AI-like your text is without rewriting:

```
/patina --score

[paste your text here]
```

Returns a 0-100 AI-likeness score with per-category breakdown:

```
| Category      | Weight | Detected | Raw Score | Weighted |
|---------------|--------|----------|-----------|----------|
| content       | 0.20   | 3/6      | 33.3      | 6.7      |
| language      | 0.20   | 1/6      | 11.1      | 2.2      |
| style         | 0.20   | 2/6      | 27.8      | 5.6      |
| communication | 0.15   | 0/3      | 0.0       | 0.0      |
| filler        | 0.10   | 1/3      | 11.1      | 1.1      |
| structure     | 0.15   | 1/4      | 25.0      | 3.8      |
| Overall       |        |          |           | 19.3 (±10) |

Interpretation: 16-30 = Mostly human-like, minor traces
```

Score ranges: **0-15** human | **16-30** mostly human | **31-50** mixed | **51-70** AI-like | **71-100** heavily AI

When used with rewrite or ouroboros mode, a **fidelity score** (0-100, higher = better) is also shown, measuring how faithfully the output preserves the original meaning:

```
| Metric        | Score   |
|---------------|---------|
| AI-likeness   | 23/100  |
| Fidelity      | 87/100  |
| Combined      | 19/100  |
```

Fidelity checks four criteria: claims preserved, no fabrication, tone match, and length ratio. The combined score weights both dimensions — configurable per profile (e.g., academic: fidelity 0.60, AI 0.40; blog: AI 0.70, fidelity 0.30).

The score is pattern-based and deterministic — it reuses the same 28 (Korean), 28 (English), 28 (Chinese), or 28 (Japanese) detection patterns from audit mode. Profile overrides affect scoring (e.g., blog profile suppresses bold pattern #14).

### Ouroboros Mode (Iterative Self-Improvement)

Automatically rewrite until the AI score drops below a target:

```
/patina --ouroboros

[paste your text here]
```

The ouroboros loop runs the full humanization pipeline repeatedly, scoring after each iteration:

```
Ouroboros Iteration Log

| Iter | Before | After | Improvement | Reason      |
|------|--------|-------|-------------|-------------|
| 0    | —      | 78    | —           | Initial     |
| 1    | 78     | 45    | +33         |             |
| 2    | 45     | 28    | +17         | Target met  |

Final score: 28/100 (±10)
Iterations: 2/3
Reason: Target met (target: 30)

[final humanized text]
```

**Termination conditions** (whichever comes first):
- **Target met**: Score drops to ≤ 30 (configurable)
- **Plateau**: Score improves by less than 10 points between iterations
- **Regression**: Score increases (text got worse) — rolls back to previous iteration
- **Max iterations**: Hard cap of 3 iterations (configurable)

**Configuration** — customize in `.patina.yaml`:

```yaml
ouroboros:
  target-score: 30          # Stop when score <= this (0-100)
  max-iterations: 3         # Maximum loop iterations
  plateau-threshold: 10     # Minimum improvement required
```

`--ouroboros` cannot be combined with `--diff`, `--audit`, or `--score`.

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

The skill loads language-specific pattern packs (`ko-*.md`, `en-*.md`, `zh-*.md`, or `ja-*.md`) and applies them through this 3-phase pipeline. Profiles and voice guidelines shape the tone.

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

### English (28 patterns)

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
<summary><b>Chinese Patterns (zh)</b> -- 28 patterns</summary>

Chinese patterns follow the same 6-category structure. `--lang zh` auto-discovers all `zh-*.md` packs.

**Content (6):** Undue significance emphasis, media/notability claims, superficial verb-chain analysis, promotional language, vague attributions, formulaic challenges-and-prospects.

**Language (6):** AI buzzword overuse (赋能/助力/深耕), four-character idiom overuse (成语堆砌), overly normalized 的/地/得, parallelism overuse (排比句), synonym cycling, verbose prepositional frames.

**Style (6):** Excessive connectors, boldface overuse, inline-header lists, 地-adverb overuse, emojis, official/bureaucratic register (公文体).

**Communication (3):** Chatbot artifacts, knowledge-cutoff disclaimers, sycophantic tone.

**Filler (3):** Filler phrases (众所周知/不可否认的是), excessive hedging, generic positive conclusions.

**Structure (4):** Structural repetition, translationese/Europeanized grammar, passive 被-overuse, total-subtotal-total (总分总) overuse.

</details>

<details>
<summary><b>Japanese Patterns (ja)</b> -- 28 patterns</summary>

Japanese patterns follow the same 6-category structure. `--lang ja` auto-discovers all `ja-*.md` packs.

**Content (6):** Undue significance emphasis, media/notability claims, superficial verb-chain analysis (〜しており), promotional language, vague attributions, formulaic challenges-and-prospects.

**Language (6):** AI buzzword overuse, 〜的(teki) suffix overuse, negative parallelisms, rule of three, synonym cycling, katakana loanword overuse.

**Style (6):** Excessive connectors, boldface overuse, inline-header lists, excessive keigo (ございます/させていただきます), emojis, overly stiff である-style register.

**Communication (3):** Chatbot artifacts, knowledge-cutoff disclaimers, sycophantic tone.

**Filler (3):** Filler phrases (周知の通り/言うまでもなく), excessive hedging, generic positive conclusions.

**Structure (4):** Structural repetition, translationese, 〜ている progressive overuse, 起承転結 formula overuse.

</details>

<details>
<summary><b>Korean vs English vs Chinese vs Japanese: where patterns differ</b></summary>

Some patterns are language-specific. Where one language has a pattern, another may have a different one in the same slot:

| # | Korean | English | Chinese | Japanese |
|---|--------|---------|---------|----------|
| 8 | -jeok suffix overuse | Copula avoidance ("serves as") | Four-character idiom overuse (成语) | -teki suffix overuse (〜的) |
| 9 | Negative parallelisms | Negative parallelisms | 的/地/得 over-normalization | Negative parallelisms |
| 10 | Rule of three | Rule of three | Parallelism overuse (排比句) | Rule of three |
| 12 | Verbose particles | False ranges ("from X to Y") | Verbose prepositional frames (在～的基础上) | Katakana loanword overuse |
| 13 | Excessive connectors | Em dash overuse | Excessive connectors (与此同时/此外) | Excessive connectors |
| 16 | Progressive tense overuse | Title Case in Headings | 地-adverb overuse (积极地/深入地) | Excessive keigo (ございます) |
| 18 | Excessive formal language | Curly quotation marks | Bureaucratic register (公文体) | Stiff である-style register |
| 25 | Structural Repetition | Metronomic Paragraph Structure | Structural Repetition | Structural Repetition |
| 26 | Translationese | Passive Nominalization Chains | Translationese/Europeanized grammar | Translationese |
| 27 | Passive Voice Overuse | Zombie Nouns | 被-overuse | ている progressive overuse |
| 28 | Unnecessary Loanwords | Stacked Subordinate Clauses | 总分总 structure overuse | 起承転結 formula overuse |

</details>

## Configuration

Edit `.patina.default.yaml`:

```yaml
version: "3.2.0"
language: ko              # ko | en | zh | ja (or use --lang flag)
profile: default
output: rewrite           # rewrite | diff | audit | score
skip-patterns: []         # e.g., [ko-filler] to skip a pack
blocklist: []             # extra words to flag
allowlist: []             # words to never flag
max-models:             # MAX mode models (claude, codex, gemini)
  - claude
  - gemini
dispatch: omc             # omc | direct
```

Pattern packs are auto-discovered by language prefix -- no need to list them manually.

## Profiles

| Profile | Tone | Best for |
|---------|------|----------|
| `default` | Keeps original tone | General purpose |
| `blog` | More personal, opinionated | Blog posts, essays |
| `academic` | Formal, evidence-based | Research papers, theses |
| `technical` | Clear, precise, no opinions | API docs, READMEs, guides |
| `social` | Casual, short, emoji-friendly | Twitter/X, Instagram, threads |
| `email` | Polite but concise | Business emails, formal letters |
| `legal` | Preserves legal conventions | Contracts, legal opinions |
| `medical` | Preserves medical precision | Clinical reports, medical papers |
| `marketing` | Persuasive, concrete | Ad copy, product pages, press releases |
| `formal` | Professional, concise | CVs, resumes, cover letters, proposals |

```
/patina --profile blog text...
/patina --profile academic text...
/patina --profile technical text...
/patina --profile formal text...
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
patina/
├── SKILL.md                  # /patina entrypoint
├── SKILL-MAX.md              # MAX mode source/reference doc
├── patina-max/               # Installable /patina-max skill directory
│   ├── SKILL.md              # MAX mode entrypoint
│   ├── core -> ../core
│   ├── patterns -> ../patterns
│   └── profiles -> ../profiles
├── .patina.default.yaml      # Configuration
├── core/voice.md             # Voice & personality guidelines
├── core/scoring.md           # Scoring algorithm reference
├── patterns/
│   ├── ko-*.md               # Korean patterns (6 packs, 28 patterns)
│   ├── en-*.md               # English patterns (6 packs, 28 patterns)
│   ├── zh-*.md               # Chinese patterns (6 packs, 28 patterns)
│   └── ja-*.md               # Japanese patterns (6 packs, 28 patterns)
├── profiles/                 # Writing style profiles
├── examples/                 # Before/after test cases
└── custom/                   # Your extensions (gitignored)
```

Inspired by [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh)'s plugin architecture: patterns are plugins, profiles are themes.

## Adding a New Language

1. Create `patterns/{lang}-content.md`, `{lang}-language.md`, etc.
2. Set `language: {lang}` in each file's frontmatter
3. Use `/patina --lang {lang}` -- auto-discovered, no config changes needed

## References

- [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) -- primary source for patterns
- [WikiProject AI Cleanup](https://en.wikipedia.org/wiki/Wikipedia:WikiProject_AI_Cleanup) -- community effort
- [blader/humanizer](https://github.com/blader/humanizer) -- original English version

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add patterns, improve examples, create profiles, and report stale patterns.

**Pattern staleness:** AI writing patterns evolve as models get fine-tuned. If you notice a pattern that's no longer a reliable signal, or spot a new AI tell, [open an issue](https://github.com/devswha/patina/issues).

## Version History

| Version | Changes |
|---------|---------|
| **3.2.0** | Ouroboros scoring system: pattern-based AI-likeness scoring (0-100), `--score` mode with category breakdown, `--ouroboros` iterative self-improvement loop with configurable termination (target/plateau/regression/max-iterations) |
| **3.1.1** | MAX mode reliability fixes: per-run temp dir, model-scoped wait loop + timeout handling, Gemini stdin dispatch, Codex CLI compatibility (`--output-last-message`, no `-q`) |
| **3.1.0** | MAX mode: installable `/patina-max` skill entrypoint + provider-aware dispatch (`claude -p` / `gemini -p` for Claude/Gemini, `codex exec` for Codex) |
| **3.0.0** | Multi-language framework, `--lang` flag, English patterns (24) from blader/humanizer, skill renamed to `patina` |
| **2.2.0** | Loanword overuse pattern (#28), badges, repo rename |
| **2.1.0** | 2-Phase pipeline, structure patterns, blog profile, examples |
| **2.0.0** | Plugin architecture: pattern packs, profiles, config |
| **1.0.0** | Initial Korean adaptation (24 patterns) |

## License

MIT
