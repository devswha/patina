**[한국어](README_KR.md)** | **[中文](README_ZH.md)** | **[日本語](README_JA.md)** | English

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code Skill](https://img.shields.io/badge/Claude%20Code-Skill-blueviolet)](https://docs.anthropic.com/en/docs/claude-code)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-3.8.0-blue)](#version-history)

> **Make AI text sound like a human wrote it.**

A [Claude Code](https://docs.anthropic.com/en/docs/claude-code) skill and standalone CLI that detects and rewrites AI writing patterns in Korean, English, Chinese, and Japanese. Pattern-based, auditable, with deterministic scoring — not a black-box LLM paraphraser.

## Demo

**Before** (AI-sounding):
> Coffee has emerged as a **pivotal cultural phenomenon** that has **fundamentally transformed** social interactions across the globe. This beloved beverage serves as a catalyst for community building, fosters meaningful connections, and facilitates cross-cultural dialogue. From the bustling cafés of Paris to the serene tea houses repurposed for coffee in Tokyo, this **remarkable journey** showcases the **innovative spirit** of human culinary exploration.

**After** (`/patina --lang en` — same claims, AI packaging removed):
> Coffee has quietly changed how people meet. Sit across from someone long enough, and something like a real connection tends to form — even between people from very different cultures. It happens in Paris cafés and in Tokyo tea houses that used to serve matcha. Somehow, one roasted bean grew into a social ritual shared across the world.

> **MPS = 100** · cultural transformation ✓ · community building ✓ · meaningful connections ✓ · cross-cultural dialogue ✓ · Paris cafés ✓ · Tokyo tea houses ✓ · culinary exploration ✓

---

## At a Glance

|  |  |
|---|---|
| **126 patterns** | 32 KO + 31 EN + 31 ZH + 32 JA |
| **AI catch rate** | 91% Korean / 76% English (HC3) |
| **False positives** | 13% NamuWiki / 19% HC3 human / 25% Wikipedia *(intrinsic — documented)* |
| **Modes** | rewrite · audit · score · diff · ouroboros |
| **Free tier** | Yes — via `codex` CLI (no API key) |
| **License** | MIT |

---

## Table of Contents

- [Quick Start](#quick-start)
- [Modes & Flags](#modes--flags)
- [MAX Mode](#max-mode-multi-model)
- [Score & Ouroboros](#score--ouroboros)
- [Authentication](#authentication)
- [How It Works](#how-it-works)
- [Calibration](#calibration)
- [Patterns](#patterns)
- [Configuration](#configuration)
- [Profiles](#profiles)
- [Custom Patterns](#custom-patterns)
- [Project Structure](#project-structure)
- [Adding a New Language](#adding-a-new-language)
- [References](#references)
- [Version History](#version-history)

---

## Quick Start

### As a Claude Code skill

One-line install:

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

Then in Claude Code:

```
/patina --lang en

[paste your text here]
```

[Manual install →](#manual-install)

### As a standalone CLI

Requires **Node.js ≥ 18**.

```bash
git clone https://github.com/devswha/patina.git
cd patina && npm install && npm link
patina --lang en input.txt
```

```bash
# Common usage
patina --lang en --profile blog input.txt
patina --lang ko --score input.txt
patina --lang en --ouroboros input.txt
patina --batch docs/*.md --suffix .humanized
```

> 🆓 **No API key required** if you have the [`codex`](https://github.com/openai/codex) CLI logged in. See [Authentication](#authentication) for the full backend list.

#### Manual install

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/devswha/patina.git ~/.claude/skills/patina
ln -snf ~/.claude/skills/patina/patina-max ~/.claude/skills/patina-max  # MAX mode skill
```

If you already cloned via the standalone CLI route, run `npm link` from that checkout instead of cloning twice.

---

## Modes & Flags

```
patina --lang <ko|en|zh|ja> [mode] [--profile <name>] [batch options] input.txt
```

| Flag | What it does |
|------|-------------|
| `--lang <ko\|en\|zh\|ja>` | Select language (default: `ko`) |
| `--profile <name>` | Tone preset — see [Profiles](#profiles) |
| `--audit` | Detect AI patterns only — no rewriting |
| `--score` | 0–100 AI-likeness score with category breakdown |
| `--diff` | Show changes pattern by pattern |
| `--ouroboros` | Iterate until score converges (with MPS rollback) |
| `--batch <glob>` | Process multiple files at once |
| `--in-place` | Overwrite originals (with `--batch`) |
| `--suffix <ext>` | Save as `{file}.{ext}.md` |
| `--outdir <dir>` | Save results to a directory |
| `--models <list>` | MAX mode — see below |

Combine freely: `patina --lang en --audit --profile blog`. See `patina --help` for all options.

---

## MAX Mode (Multi-Model)

Run the same text through Claude, Codex, and Gemini independently. Each model humanizes, results are scored for AI-likeness + MPS, and the lowest-scoring (most human) result that passes MPS ≥ 70 wins.

```
/patina-max

[paste your text here]
```

| Model | Dispatch | Auth |
|-------|----------|------|
| `claude` | `claude -p` | Claude Code |
| `codex` | `codex exec --skip-git-repo-check --output-last-message` | ChatGPT OAuth |
| `gemini` | `gemini -p '' --output-format text` | Google AI Studio |

Each MAX run uses an isolated temp directory, waits only for selected models, and marks timeouts as failures (no infinite waits).

> Standalone CLI MAX: `patina --models gpt-4o,gpt-4o-mini input.txt` calls models via the same `--base-url`. To mix providers, point `--base-url` at OpenRouter or another multi-provider gateway. The Claude Code `/patina-max` skill dispatches via local CLIs — no API key needed.

---

## Score & Ouroboros

### Score mode

Check how AI-like your text is without rewriting:

```bash
patina --score input.txt
```

```
| Category      | Weight | Detected | Raw  | Weighted |
|---------------|--------|----------|------|----------|
| content       | 0.20   | 3/6      | 33.3 | 6.7      |
| language      | 0.20   | 1/6      | 11.1 | 2.2      |
| style         | 0.20   | 2/6      | 27.8 | 5.6      |
| communication | 0.15   | 0/3      | 0.0  | 0.0      |
| filler        | 0.10   | 1/3      | 11.1 | 1.1      |
| structure     | 0.15   | 1/4      | 25.0 | 3.8      |
| Overall       |        |          |      | 19.3 (±10) |
```

| Range | Interpretation |
|-------|---------------|
| 0–15 | Human |
| 16–30 | Mostly human |
| 31–50 | Mixed |
| 51–70 | AI-like |
| 71–100 | Heavily AI |

When combined with rewriting, also reports:

| Metric | Score | Meaning |
|--------|-------|---------|
| AI-likeness | 23/100 | Lower = more human |
| Fidelity | 87/100 | Claims preserved, no fabrication, tone, length |
| MPS | 92/100 | Semantic anchors (claims, polarity, causation, numbers) |
| Combined | 19/100 | Profile-weighted (e.g., blog: AI 0.70 / fidelity 0.30) |

### Ouroboros mode

Iterate the rewrite until score converges:

```bash
patina --ouroboros input.txt
```

```
| Iter | Before | After | Improvement | Reason     |
|------|--------|-------|-------------|------------|
| 0    | —      | 78    | —           | Initial    |
| 1    | 78     | 45    | +33         |            |
| 2    | 45     | 28    | +17         | Target met |
```

Termination conditions (whichever comes first):
- Target met (score ≤ 30, configurable)
- Plateau (improvement < 10 between iterations)
- Regression (score increased — rolls back)
- Max iterations (default 3)
- Fidelity / MPS floor breach (rolls back)

Configure in `.patina.yaml`:

```yaml
ouroboros:
  target-score: 30
  max-iterations: 3
  plateau-threshold: 10
  fidelity-floor: 70
  mps-floor: 70
```

> `--ouroboros` cannot be combined with `--diff`, `--audit`, or `--score`.

---

## Authentication

| Backend | Setup | Cost |
|---------|-------|------|
| `codex-cli` *(default when available)* | `codex login` | **Free** (ChatGPT OAuth) |
| OpenAI-compatible HTTP | `PATINA_API_KEY=...` | Per provider |
| Google Gemini | `GEMINI_API_KEY=...` + `--provider gemini` | Free tier |
| Groq | `GROQ_API_KEY=...` + `--provider groq` | Free tier |
| Together AI | `TOGETHER_API_KEY=...` + `--provider together` | Free models available |
| OpenRouter | `--base-url https://openrouter.ai/api/v1` + key | Per provider |

```bash
patina auth status         # backend availability + auth state
patina auth login          # per-backend login instructions
patina --list-providers    # preset providers + key status
```

If `PATINA_API_KEY` is unset and `codex` is logged in, patina auto-falls back to `codex-cli`.

> `codex-cli` v1 supports single-mode rewrites only. `--audit`, `--score`, `--diff`, `--ouroboros`, and `--models`/MAX still go through the HTTP backend.

Default environment variables:

```bash
PATINA_API_KEY=...                            # required for HTTP backend
PATINA_API_BASE=https://api.openai.com/v1     # or proxy
PATINA_MODEL=gpt-4o                           # default model
```

---

## How It Works

```
Input text
  │
  ▼
[Step 4.5]   Semantic anchor extraction
             (key claims, polarity, causation, numbers)
  │
  ▼
[Step 4.6]   Stylometric pre-pass
             (burstiness CV + MATTR)
  │
  ▼
[Step 4.7]   AI-lexicon overlap
             (flat dictionary: ~108 EN / 102 KO entries)
  │
  ▼
[Phase 1]    Structure scan
             (paragraph-level: repetition, passive voice)
  │
  ▼
[Step 5a-v]  Anchor verification
  │
  ▼
[Phase 2]    Sentence rewrite
             (word-level: AI vocab, filler, hedging)
  │
  ▼
[Step 5b-v]  Anchor verification
  │
  ▼
[Phase 3]    Self-audit
             (polarity scan, regression, final MPS)
  │
  ▼
Natural-sounding text (meaning verified)
```

Pattern packs are auto-discovered by language prefix (`{lang}-*.md`). Semantic anchors are extracted before rewriting and verified after each phase — if meaning is corrupted, the change is retried or rolled back.

---

## Calibration

Reproducible against `.omc/research/v3_7_lexicon_eval.py` over a 400-paragraph corpus (HC3 + Wikipedia + NamuWiki + paired ko/AI):

| Source | Hot rate | Notes |
|--------|----------|-------|
| HC3 ChatGPT (en) | **76%** | AI catch rate |
| HC3 human (en) | 19% | False positive on real human writing |
| Wikipedia (en) | 25% | Encyclopedic register has uniform sentence length — intrinsic boundary |
| NamuWiki (ko) | 13% | False positive on Korean human prose |
| ko/AI corpus | **91%** | Strongest signal in the system *(post-v3.8.0)* |

Acceptance gates: AI catch ≥ 75% · max FP ≤ 25% · NamuWiki regression ≤ +5pp. All met.

> Stylometric and lexicon signals are **advisory** for the LLM, not sole-decision gates. The 25% Wikipedia FP is intrinsic to encyclopedic prose, not a bug we can tune away. Documented in `core/stylometry.md` §13, §16.

---

## Patterns

All four languages share the same 6-category structure. Most patterns are universal; a few slots have language-specific variants. Patterns #30 (rhetorical question openers) and #31 (conclusion signal words) exist in all four languages. Pattern #32 (comparative adverb overuse — KO `보다`, JA `より`) is KO/JA-specific.

### Universal categories

<details>
<summary><b>Content</b> — 6 patterns (#1–#6)</summary>

| # | Pattern | What AI does | Fix |
|---|---------|-------------|-----|
| 1 | Importance Inflation | "groundbreaking milestone" | Specific facts, dates, numbers |
| 2 | Media/Notability Inflation | "garnered significant attention" | Cite one specific source |
| 3 | Superficial Analysis | Chains of "-ing" verbs | Real explanation or sources |
| 4 | Promotional Language | "stunning, world-class" | Neutral description |
| 5 | Vague Attributions | "experts say... studies show" | Name the actual source |
| 6 | Formulaic Challenges/Prospects | "despite challenges... bright future" | Specific problems and plans |

</details>

<details>
<summary><b>Communication</b> — 4 patterns (#19–#21, #29)</summary>

| # | Pattern | What AI does | Fix |
|---|---------|-------------|-----|
| 19 | Chatbot Phrases | "Hope this helps! Let me know" | Remove |
| 20 | Training Cutoff Disclaimers | "as of my last update" | Find sources or remove |
| 21 | Sycophantic Tone | "Great question!" | Respond directly |
| 29 | False Nuance | "Actually, it's more nuanced..." | Add evidence or cut |

</details>

<details>
<summary><b>Filler & Hedging</b> — 3 patterns (#22–#24)</summary>

| # | Pattern | What AI does | Fix |
|---|---------|-------------|-----|
| 22 | Filler Phrases | Padding words | Cut |
| 23 | Excessive Hedging | Over-qualified statements | Direct |
| 24 | Vague Positive Conclusions | "bright future ahead" | Specifics |

</details>

### Language-specific slots

<details>
<summary><b>Language</b> (#7–#12) — grammar and vocabulary</summary>

| # | KO | EN | ZH | JA |
|---|----|----|----|----|
| 7 | AI filler vocabulary | AI vocabulary (delve, tapestry) | AI buzzwords (赋能/助力) | AI buzzword overuse |
| 8 | -jeok (적) suffix | Copula avoidance ("serves as") | Four-character idioms (成语) | -teki (的) suffix |
| 9 | Negative parallelisms | Negative parallelisms | 的/地/得 over-normalization | Negative parallelisms |
| 10 | Rule of three | Rule of three | Parallelism overuse (排比句) | Rule of three |
| 11 | Synonym cycling | Synonym cycling | Synonym cycling | Synonym cycling |
| 12 | Verbose particles | False ranges ("from X to Y") | Verbose prepositional frames | Katakana loanword overuse |

</details>

<details>
<summary><b>Style</b> (#13–#18) — formatting and register</summary>

| # | KO | EN | ZH | JA |
|---|----|----|----|----|
| 13 | Excessive connectors | Em dash overuse | Excessive connectors | Excessive connectors |
| 14 | Boldface overuse | Boldface overuse | Boldface overuse | Boldface overuse |
| 15 | Inline-header lists | Inline-header lists | Inline-header lists | Inline-header lists |
| 16 | Progressive tense (-고 있다) | Title Case in headings | 地-adverb overuse | Excessive keigo |
| 17 | Emojis | Emojis | Emojis | Emojis |
| 18 | Excessive formal language | Curly quotation marks | Bureaucratic register (公文体) | Stiff である-style |

</details>

<details>
<summary><b>Structure</b> (#25–#28) — document-level</summary>

| # | KO | EN | ZH | JA |
|---|----|----|----|----|
| 25 | Structural repetition | Metronomic paragraphs | Structural repetition | Structural repetition |
| 26 | Translationese | Passive nominalization chains | Translationese / Europeanized | Translationese |
| 27 | Passive voice overuse | Zombie nouns | 被-overuse | ている progressive overuse |
| 28 | Unnecessary loanwords | Stacked subordinate clauses | 总分总 structure overuse | 起承転結 formula overuse |

</details>

### Universal extensions (v3.4.0+)

| # | All languages |
|---|---------------|
| 30 | Rhetorical question openers ("Have you ever wondered…?") |
| 31 | Conclusion signal words ("In conclusion", "결론적으로", "总而言之", "結論として") |
| 32 | Comparative adverb overuse — KO `보다` / JA `より` only |

---

## Configuration

```yaml
# .patina.default.yaml
version: "3.8.0"
language: ko              # ko | en | zh | ja
profile: default
output: rewrite           # rewrite | diff | audit | score
skip-patterns: []         # e.g., [ko-filler] to skip a pack
blocklist: []             # extra words to flag
allowlist: []             # words to never flag
max-models: [claude, gemini]
dispatch: omc             # omc | direct
```

Pattern packs are auto-discovered by language prefix — no need to list them manually.

---

## Profiles

| Profile | Tone | Best for |
|---------|------|----------|
| `default` | Keeps original tone | General purpose |
| `blog` | Personal, opinionated | Blog posts, essays |
| `academic` | Formal, evidence-based | Research papers |
| `technical` | Clear, precise | API docs, READMEs, guides |
| `social` | Casual, emoji-friendly | Twitter/X, threads |
| `email` | Polite but concise | Business emails |
| `legal` | Preserves legal conventions | Contracts |
| `medical` | Preserves medical precision | Clinical reports |
| `marketing` | Persuasive, concrete | Ad copy, press releases |
| `formal` | Professional, concise | CVs, proposals |

```bash
patina --profile blog text...
```

---

## Custom Patterns

Drop a `.md` file into `custom/patterns/` — auto-loaded:

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

---

## Project Structure

```
patina/
├── SKILL.md                  # /patina entrypoint
├── SKILL-MAX.md              # MAX mode reference
├── patina-max/               # /patina-max skill (installable)
│   └── SKILL.md
├── .patina.default.yaml      # Configuration
├── core/
│   ├── voice.md              # Voice & personality guidelines
│   ├── scoring.md            # Scoring algorithm reference
│   └── stylometry.md         # Stylometric algorithm reference
├── lexicon/
│   ├── ai-en.md              # English AI lexicon (108 entries)
│   └── ai-ko.md              # Korean AI lexicon (102 entries)
├── patterns/
│   ├── ko-*.md               # Korean (6 packs, 32 patterns)
│   ├── en-*.md               # English (6 packs, 31 patterns)
│   ├── zh-*.md               # Chinese (6 packs, 31 patterns)
│   └── ja-*.md               # Japanese (6 packs, 32 patterns)
├── profiles/                 # Tone presets
├── examples/                 # Before/after test cases
└── custom/                   # User extensions (gitignored)
```

Inspired by [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh)'s plugin architecture: patterns are plugins, profiles are themes.

---

## Adding a New Language

1. Create `patterns/{lang}-content.md`, `{lang}-language.md`, etc.
2. Set `language: {lang}` in each file's frontmatter.
3. Use `/patina --lang {lang}` — auto-discovered, no config changes.

---

## References

- [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) — primary source
- [WikiProject AI Cleanup](https://en.wikipedia.org/wiki/Wikipedia:WikiProject_AI_Cleanup) — community effort
- [blader/humanizer](https://github.com/blader/humanizer) — original English version

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Pattern submissions and **staleness reports** ("this signal isn't AI anymore") are the highest-value contributions — AI writing patterns evolve as models get fine-tuned.

[Open an issue →](https://github.com/devswha/patina/issues)

---

## Version History

| Version | Highlights |
|---------|-----------|
| **3.8.0** | Korean lexicon re-curation via differential-frequency mining (NamuWiki vs Claude-generated KO). Korean AI catch: 83% → **91%** (+8pp). Zero FP regression. |
| **3.7.0** | AI-lexicon overlap signal (step 4.7). 108 EN + 90 KO entries. Hot rule extends to 3-signal OR. AI catch on HC3 ChatGPT: 66% → **76%** — first Pareto break since v3.5.1. |
| **3.5.1** | Stylometric burstiness threshold 0.25 → 0.30 after 300-paragraph external validation. AI catch 57% → 66%. |
| **3.5.0** | Stylometric suspect-zone detection (step 4.6) — burstiness CV + MATTR. ko + en in v1. |
| **3.4.0** | codex-cli backend (no API key), `patina auth` subcommand, free-tier provider shortcuts. Patterns #30, #31 across all languages; #32 for KO/JA. CI workflow added. |
| **3.3.0** | Meaning Preservation System (MPS). |
| **3.2.0** | Ouroboros scoring + iterative self-improvement loop. |
| **3.1.x** | MAX mode reliability, multi-CLI dispatch (claude / codex / gemini). |
| **3.0.0** | Multi-language framework, `--lang` flag, English patterns from blader/humanizer, renamed to `patina`. |
| **2.x** | Plugin architecture, blog profile, structure patterns, loanword pattern (#28). |
| **1.0.0** | Initial Korean adaptation (24 patterns). |

<details>
<summary><b>Detailed release notes</b></summary>

#### 3.8.0 — Data-driven Korean lexicon mining

v3.7.0's Korean lexicon was author-curated and contributed only +1pp on AI catch (vs +10pp on English). v3.8.0 mines the corpus for high-signal Korean phrases via differential frequency against NamuWiki human prose, surfacing 12 register markers AI text uses heavily but humans rarely.

Mining rule (`.omc/research/v3_8_ko_lexicon_mine.py`):
- 어절 doc-frequency: AI count ≥ 4 AND ratio AI / (human + 1) ≥ 4.0
- Reject domain artifacts (proper nouns, year-tokens)
- Keep only register markers (passive evaluation, encyclopedic verbs, quantifier scaffolding)

Added entries:
- Strict (8): `평가된다`, `꼽힌다`, `가리킨다`, `사례로`, `다수의`, `알려져`, `일컬어진다`, `평가받다`
- Phrases (4): `가운데 하나로`, `자리 잡았다`, `알려져 있다`, `~의 사례로`

Result on 500-paragraph corpus: ko/AI catch 83% → **91%** (+8pp). NamuWiki human FP held at **13%** — zero regression, clean Pareto win.

#### 3.7.0 — AI-lexicon overlap signal

A flat dictionary (`lexicon/ai-en.md` 108 entries, `lexicon/ai-ko.md` 90 entries) flags AI-favored phrases the 28-pattern catalog does not enumerate. Densities computed per 1000 tokens; the 4.6 hot rule extends to a 3-signal OR (burstiness OR MATTR OR lexicon_density > 2.0).

Calibrated against 400 paragraphs: AI catch 66% → **76%**, HC3 human FP 12%→19%, Wikipedia FP 23%→**25%** boundary, NamuWiki FP 11%→13% (within +5pp guardrail). All acceptance gates met — first Pareto improvement over the v3.5.1 wall.

Drop list (post-eval): `intersection`, `principles`, `mindset`, `iterative`, `responsible`, `methodologies`, `redefine`, `accessible`, `equitable`, `one of the most`, `in conjunction with`, `the power of` — fired more on academic prose than on AI text.

Skipped v3.6 (n-gram dropped, §15 negative finding).

#### 3.5.1 — Stylometric calibration patch

Raised `stylometry.burstiness.bands.low` from 0.25 to 0.30 after external validation against 300 paragraphs. v3.5.0 only caught 57% of real AI text; v3.5.1 catches 66% with HC3 human FP 12% and Wikipedia FP 23%.

Sweep showed no threshold combo satisfies both AI ≥70% and max FP ≤20% — Wikipedia's encyclopedic register naturally has uniform sentence length. MATTR threshold unchanged (0.55). v3.5.x is an advisory marker for the LLM, not a sole-decision gate.

</details>

---

## License

MIT
