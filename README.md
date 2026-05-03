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
> Coffee has emerged as a **pivotal cultural phenomenon** that has **fundamentally transformed** social interactions across the globe. This beloved beverage serves as a catalyst for community building, fosters meaningful connections, and facilitates cross-cultural dialogue. From the bustling cafés of Paris to the serene tea houses repurposed for coffee in Tokyo, this **remarkable journey** showcases the **innovative spirit** of human culinary exploration.

**After** (humanized by `/patina --lang en` — same meaning, less AI):
> Coffee has quietly changed how people meet. Sit across from someone long enough, and something like a real connection tends to form — even between people from very different cultures. It happens in Paris cafés and in Tokyo tea houses that used to serve matcha. Somehow, one roasted bean grew into a social ritual shared across the world.

Anchor verification (MPS = 100): global social transformation ✓, community building ✓, meaningful connections ✓, cross-cultural dialogue ✓, Paris cafés ✓, Tokyo tea houses ✓, culinary exploration ✓. Only the AI packaging was removed.

118 patterns detected across Korean (30), English (30), Chinese (29), and Japanese (29). See the [full pattern list](#patterns) below.

> 🆓 **No API key required.** With the [`codex`](https://github.com/openai/codex) CLI installed, the standalone `patina` runs for free via OpenAI/ChatGPT OAuth — no `PATINA_API_KEY` needed. See [Standalone CLI > Backends](#backends-run-without-an-api-key) for the one-line setup.

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

### Standalone CLI

Patina also works as a standalone Node.js CLI tool that can be used from any terminal, shell script, or CI/CD pipeline.

**Requirements:** Node.js ≥ 18

**Install locally:**
```bash
git clone https://github.com/devswha/patina.git
cd patina
npm install
npm link        # makes `patina` available globally
```

> Already ran the quick install above? The repo is already at `~/.claude/skills/patina`. Just `cd ~/.claude/skills/patina && npm install && npm link` instead of cloning again.

**Or use without installing:**
```bash
node bin/patina.js --lang en input.txt
```

**Environment variables:**
```bash
export PATINA_API_KEY="your-api-key"
export PATINA_API_BASE="https://api.openai.com/v1"  # or your proxy
export PATINA_MODEL="gpt-4o"                        # default model
```

**CLI usage:**
```bash
patina --lang en --profile blog input.txt
patina --lang ko --score input.txt
patina --lang en --ouroboros input.txt
patina --lang en --models gpt-4o,gpt-4o-mini input.txt  # MAX mode
patina --batch docs/*.md --suffix .humanized
```

> `--models` calls each listed model via the same `--base-url` endpoint, so all models must be served by that endpoint. To mix providers (OpenAI + Anthropic + Google), point `--base-url` at a multi-provider gateway like OpenRouter. The separate `/patina-max` Claude Code skill dispatches via local `claude`, `codex`, and `gemini` CLIs instead — no API key needed.

**Backends (run without an API key):**
```bash
patina auth status                                        # show backend availability + authentication
patina auth login                                         # per-backend instructions for authenticating
patina --backend codex-cli --lang ko input.txt            # uses local codex CLI explicitly
patina --model codex --lang ko input.txt                  # same — auto-routes by model name
patina --lang ko input.txt                                # auto-fallback: if no PATINA_API_KEY and
                                                          # codex is logged in, patina uses it for free
```

> `codex-cli` backend dispatches via the local [`codex`](https://github.com/openai/codex) CLI, which authenticates via OpenAI/ChatGPT OAuth — no `PATINA_API_KEY` needed. Run `codex login` once and patina picks it up automatically. Single-mode rewrites only (`--audit`, `--score`, `--diff`, `--ouroboros`, `--models`/MAX still go through the HTTP backend in v1).

See `patina --help` for all options.

## Use

In Claude Code, type:

```
/patina --lang en

[paste your text here]
```

Use `--lang` to select your language:

| Flag | Language |
|------|----------|
| `--lang ko` | Korean |
| `--lang en` | English |
| `--lang zh` | Chinese |
| `--lang ja` | Japanese |

The default language is set in `.patina.default.yaml` (default: `ko`). You can change it there or override per-run with `--lang`.

### More Options

| Flag | What it does |
|------|-------------|
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

Each model humanizes independently, results are scored for AI-likeness and meaning preservation (MPS), and the lowest-scoring (most human) result that passes the MPS floor (≥ 70) wins.

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
| Metric               | Score   |
|----------------------|---------|
| AI-likeness          | 23/100  |
| Fidelity             | 87/100  |
| MPS (meaning)        | 92/100  |
| Combined             | 19/100  |
```

Fidelity checks four criteria: claims preserved, no fabrication, tone match, and length ratio. MPS (Meaning Preservation Score) tracks whether specific semantic anchors -- claims, polarity, causation, numbers -- survived the rewriting pipeline. The combined score weights AI-likeness and fidelity — configurable per profile (e.g., academic: fidelity 0.60, AI 0.40; blog: AI 0.70, fidelity 0.30).

The score is pattern-based and deterministic — it reuses the same 30 (Korean), 30 (English), 29 (Chinese), or 29 (Japanese) detection patterns from audit mode. Profile overrides affect scoring (e.g., blog profile suppresses bold pattern #14).

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
- **Fidelity floor**: Fidelity drops below 70 — rolls back to previous iteration
- **MPS floor**: MPS (meaning preservation) drops below 70 — rolls back to previous iteration

**Configuration** — customize in `.patina.yaml`:

```yaml
ouroboros:
  target-score: 30          # Stop when score <= this (0-100)
  max-iterations: 3         # Maximum loop iterations
  plateau-threshold: 10     # Minimum improvement required
  fidelity-floor: 70        # Stop if fidelity drops below this
  mps-floor: 70             # Stop if meaning preservation drops below this
```

`--ouroboros` cannot be combined with `--diff`, `--audit`, or `--score`.

## How It Works

```
Your text
  |
  v
[Step 4.5] Semantic Anchor Extraction -- extract key claims, polarity, causation, numbers
  |
  v
[Phase 1] Structure scan -- fix paragraph-level issues (repetition, passive voice)
  |
  v
[Step 5a-v] Anchor Verification -- check meaning preserved after Phase 1
  |
  v
[Phase 2] Sentence rewrite -- fix word-level issues (AI vocabulary, filler, hedging)
  |
  v
[Step 5b-v] Anchor Verification -- check meaning preserved after Phase 2
  |
  v
[Phase 3] Self-audit -- polarity scan, regression check, final MPS calculation
  |
  v
Natural-sounding text (meaning verified)
```

The skill loads language-specific pattern packs (`ko-*.md`, `en-*.md`, `zh-*.md`, or `ja-*.md`) and applies them through this pipeline. Semantic anchors (key claims, polarity, numbers) are extracted before rewriting and verified after each phase -- if meaning is corrupted, the offending change is retried or rolled back. Profiles and voice guidelines shape the tone.

## <a name="patterns"></a>Patterns

All four languages share the same 6-category structure (118 patterns total: 30 KO + 30 EN + 29 ZH + 29 JA). The categories and most patterns are universal — only a few slots have language-specific variants. Pattern #30 (rhetorical question openers) currently lives in KO and EN only; ZH/JA parity is follow-up work.

### Shared Pattern Categories

<details>
<summary><b>Content Patterns</b> — 6 patterns for substance issues</summary>

These patterns are identical across all four languages:

| # | Pattern | What AI does | Fix |
|---|---------|-------------|-----|
| 1 | Importance Inflation | "groundbreaking milestone", "pivotal turning point" | Replace with specific facts, dates, numbers |
| 2 | Media/Notability Inflation | "garnered significant attention" | Cite one specific source |
| 3 | Superficial Analysis | Chains of "-ing"/"-하며" verbs with no real explanation | Remove filler or add real sources |
| 4 | Promotional Language | "stunning, world-class, hidden gem" | Neutral description with facts |
| 5 | Vague Attributions | "experts say... studies show" | Name the actual source |
| 6 | Formulaic Challenges/Prospects | "despite challenges... bright future" | Specific problems and concrete plans |

</details>

<details>
<summary><b>Communication Patterns</b> — 4 patterns for chatbot artifacts</summary>

These patterns are identical across all four languages:

| # | Pattern | What AI does | Fix |
|---|---------|-------------|-----|
| 19 | Chatbot Phrases | "Hope this helps! Let me know" | Remove entirely |
| 20 | Training Cutoff Disclaimers | "as of my last update" | Find sources or remove |
| 21 | Sycophantic Tone | "Great question! Exactly right" | Respond directly |
| 29 | False Nuance | "Actually, it's more nuanced..." | Add real evidence or cut |

</details>

<details>
<summary><b>Filler & Hedging Patterns</b> — 3 patterns for padding</summary>

These patterns are identical across all four languages:

| # | Pattern | What AI does | Fix |
|---|---------|-------------|-----|
| 22 | Filler Phrases | Unnecessary padding words | Cut the filler |
| 23 | Excessive Hedging | Over-qualified statements | Direct statement |
| 24 | Vague Positive Conclusions | "bright future ahead" | Specific plans or facts |

</details>

### Language-Specific Patterns

Some pattern slots have different implementations per language, targeting each language's unique AI tells:

<details>
<summary><b>Language Patterns</b> (#7–#12) — grammar and vocabulary</summary>

| # | Korean | English | Chinese | Japanese |
|---|--------|---------|---------|----------|
| 7 | AI filler vocabulary | AI vocabulary (delve, tapestry) | AI buzzwords (赋能/助力/深耕) | AI buzzword overuse |
| 8 | -jeok (적) suffix overuse | Copula avoidance ("serves as") | Four-character idiom overuse (成语) | -teki (的) suffix overuse |
| 9 | Negative parallelisms | Negative parallelisms | 的/地/得 over-normalization | Negative parallelisms |
| 10 | Rule of three | Rule of three | Parallelism overuse (排比句) | Rule of three |
| 11 | Synonym cycling | Synonym cycling | Synonym cycling | Synonym cycling |
| 12 | Verbose particles | False ranges ("from X to Y") | Verbose prepositional frames | Katakana loanword overuse |

</details>

<details>
<summary><b>Style Patterns</b> (#13–#18) — formatting and register</summary>

| # | Korean | English | Chinese | Japanese |
|---|--------|---------|---------|----------|
| 13 | Excessive connectors | Em dash overuse | Excessive connectors | Excessive connectors |
| 14 | Boldface overuse | Boldface overuse | Boldface overuse | Boldface overuse |
| 15 | Inline-header lists | Inline-header lists | Inline-header lists | Inline-header lists |
| 16 | Progressive tense (-고 있다) | Title Case in headings | 地-adverb overuse | Excessive keigo (ございます) |
| 17 | Emojis | Emojis | Emojis | Emojis |
| 18 | Excessive formal language | Curly quotation marks | Bureaucratic register (公文体) | Stiff である-style |

</details>

<details>
<summary><b>Structure Patterns</b> (#25–#29) — document-level issues</summary>

| # | Korean | English | Chinese | Japanese |
|---|--------|---------|---------|----------|
| 25 | Structural repetition | Metronomic paragraph structure | Structural repetition | Structural repetition |
| 26 | Translationese | Passive nominalization chains | Translationese/Europeanized | Translationese |
| 27 | Passive voice overuse | Zombie nouns | 被-overuse | ている progressive overuse |
| 28 | Unnecessary loanwords | Stacked subordinate clauses | 总分总 structure overuse | 起承転結 formula overuse |
| 29 | False Nuance | False Nuance | False Nuance (虚假细化) | False Nuance (偽りのニュアンス) |

</details>

## Configuration

Edit `.patina.default.yaml`:

```yaml
version: "3.3.0"
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
├── core/scoring.md           # Scoring algorithm (AI-likeness + fidelity + MPS)
├── patterns/
│   ├── ko-*.md               # Korean patterns (6 packs, 29 patterns)
│   ├── en-*.md               # English patterns (6 packs, 29 patterns)
│   ├── zh-*.md               # Chinese patterns (6 packs, 29 patterns)
│   └── ja-*.md               # Japanese patterns (6 packs, 29 patterns)
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
| **3.3.0** | Meaning Preservation System (MPS): ensures humanized text maintains original intent and claims |
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
