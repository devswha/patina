**[한국어](README_KR.md)** | **[中文](README_ZH.md)** | **[日本語](README_JA.md)** | English

<p align="center">
  <img src="assets/brand/patina-logo.svg?v=20260520" alt="patina — Strip the AI packaging. Keep the meaning." width="440">
</p>

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Skill](https://img.shields.io/badge/Skill-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%20OpenCode-blueviolet)](#quick-start)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-3.11.0-blue)](CHANGELOG.md)

> **Strip the AI packaging. Keep the meaning.**

Detects and rewrites AI writing patterns in Korean, English, Chinese, and Japanese. Runs as a skill for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex), [Cursor](https://cursor.sh), and OpenCode, or as a standalone Node.js CLI.

Unlike a generic paraphraser, patina is **pattern-based and auditable**: it shows what it changed, why it changed it, and whether the original claims were preserved.

## Demo

**Before** *(AI-sounding)*:
> Coffee has emerged as a **pivotal cultural phenomenon** that has **fundamentally transformed** social interactions across the globe. This beloved beverage serves as a catalyst for community building, fosters meaningful connections, and facilitates cross-cultural dialogue.

**After** *(`/patina --lang en` — same claims, AI packaging removed)*:
> Coffee has quietly changed how people meet. Sit across from someone long enough, and something like a real connection tends to form — even between people from very different cultures.

> **MPS = 100** · cultural transformation ✓ · community building ✓ · meaningful connections ✓ · cross-cultural dialogue ✓

More examples: [Before/After Gallery](docs/EXAMPLES.md).
Brand assets: [logo](assets/brand/patina-logo.svg), [icon](assets/brand/patina-icon.svg),
[social preview](assets/social/patina-og.svg), and [before/after card](assets/social/patina-before-after.svg).

## At a Glance

|  |  |
|---|---|
| **146 patterns** | 37 KO + 36 EN + 36 ZH + 37 JA (each incl. 5 score-only viral-hook) — see [PATTERNS.md](docs/PATTERNS.md) |
| **AI catch rate** | 91% Korean / 76% English (HC3) |
| **Benchmark report** | Reproducible suspect-zone benchmark: [latest.md](docs/benchmarks/latest.md) · [latest.json](docs/benchmarks/latest.json) |
| **False positives** | 13–25% on human prose *(boundary intrinsic to encyclopedic register, [documented](core/stylometry.md))* |
| **Modes** | rewrite · audit · score · diff · ouroboros |
| **Free tier** | Yes — via `codex` CLI (no API key) |
| **Determinism** | Scoring formula is deterministic; LLM severity assignment ±8–10 pt per run ([scoring.md §8](core/scoring.md)) |
| **License** | MIT |

## Quick Start

### As a Claude Code or Codex CLI skill

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

The installer wires patina into Claude Code, [Codex CLI](https://github.com/openai/codex), Cursor, and OpenCode. Then:

```
/patina --lang en

[paste your text here]
```

Rewrite with a specific tone:

```
/patina --tone narrative

[paste your essay draft here]
```

Auto-detect and apply the best-fit tone:

```
/patina --tone auto --lang en

[paste your text here]
```

### As a standalone CLI

Requires Node.js ≥ 18.

```bash
git clone https://github.com/devswha/patina.git
cd patina && npm install && npm link
patina --lang en input.txt
```

Or try stdin after linking:

```bash
printf '%s\n' 'Coffee has emerged as a pivotal cultural phenomenon that has fundamentally transformed social interactions across the globe.' \
  | patina --lang en --backend codex-cli
```

> 🆓 **No API key required** if you have any of [`codex`](https://github.com/openai/codex), [`claude`](https://docs.anthropic.com/en/docs/claude-code), or [`gemini`](https://github.com/google-gemini/gemini-cli) CLIs logged in. Pick one with `--backend codex-cli | claude-cli | gemini-cli`, or let the model heuristic route automatically (`--model claude-*` → claude-cli, etc.). See [AUTHENTICATION.md](docs/AUTHENTICATION.md) for the full backend list.

## Modes

```
patina --lang <ko|en|zh|ja> [mode] [--profile <name>] input.txt
```

| Flag | What it does |
|------|-------------|
| *(default)* | Rewrite |
| `--audit` | Detect AI patterns only |
| `--score` | 0–100 AI-likeness score with category breakdown |
| `--diff` | Show changes pattern by pattern |
| `--ouroboros` | Iterate the rewrite until score converges (with MPS rollback) |
| `--lang <ko\|en\|zh\|ja>` | Select language (default: `ko`) |
| `--profile <name>` | Tone preset: `blog`, `academic`, `technical`, `formal`, `social`, `email`, `legal`, `medical`, `marketing`, `narrative`, `instructional`, `casual-conversation` |
| `--tone <name>` | Tone category: `casual`, `professional`, `academic`, `narrative`, `marketing`, `instructional`, `auto` |
| `--batch` | Treat positional args as a list of files (e.g. `--batch docs/*.md`) |

`patina --help` for the full flag list.

### Score-only patterns

`--score` and `--audit` measure a slightly broader set of signals than `--rewrite` does. The viral-hook packs (`ko/en/zh/ja-viral-hook`, 5 patterns each: shock-number hooks, clickbait closings, source-skipping authority claims, breath-optimized short-sentence stacking, hyperbolic engagement lexicon) are **detection-only** — they surface in the score and audit so the benchmark matches human intuition for SNS-style marketing copy across all four languages, but `--rewrite`/`--diff`/`--ouroboros` skip them because those signals are often intentional rhetoric. Real-world demos: [`examples/viral-hook/`](examples/viral-hook/).

### Prompt-mode tuning (v3.11)

`--prompt-mode strict|minimal|auto` lets you trade off between the full pattern packs (~34KB structured prompt) and a compressed casual instruction (~3KB). `auto` picks per backend — Gemini does better on minimal (it gets over-constrained by long structured prompts), while Claude leverages the full packs and Codex is roughly insensitive. case-05 documents the A/B.

### Multiple stylistic variants (v3.11)

`--variants <1-5>` asks the model for N voice variants of the rewrite in one call (e.g., V1 casual, V2 direct, V3 measured) — facts, numbers, and causation stay identical across variants. Each comes back as `## Variant N` so you can pick the voice you want.

### Short-text scoring boost (v3.11)

For inputs ≤200 chars or ≤3 paragraphs, register-sensitive categories (`language`, `style`, `viral-hook`) get a 1.5× severity multiplier so single-paragraph voice shifts surface in the score. case-04 found these were undercounted by the long-text formula.

### Self-audit isolation (v3.11)

In rewrite mode, the model emits its self-audit notes inside `[SELF_AUDIT]`/`[/SELF_AUDIT]` tags wrapped around a `[BODY]`/`[/BODY]` block (or `[VARIANT n]` blocks when `--variants > 1`). patina strips the audit before showing the user, so raw output is clean — earlier versions sometimes leaked phrases like "남아 있는 AI 티" or "Phase 3" preambles into the user-facing text.

### Score weight drift detection (v3.11)

`--score` runs cross-check the Weight column the model emits against your config's `category-weights`. If the model invents a category (e.g., `discord`) or substitutes a different number, `[patina]` warnings hit stderr — observability only, the score itself isn't altered.

## Tones

`--tone` selects a named voice axis applied on top of pattern rewriting. Resolution order: `--tone` CLI > `tone:` config > `profile:` config.

| Tone | Intended for | Key behaviors |
|------|-------------|---------------|
| `casual` | Blog posts, social content, personal notes | Contractions, first-person, emoticons OK, low formality |
| `professional` | Work emails, reports, business writing | Clear and concise, formal but not stiff; legal/medical sub-profiles force fidelity floor |
| `academic` | Papers, research summaries, technical analysis | Objective, evidence-oriented, minimal first-person |
| `narrative` | Personal essays, memoir, experience-based writing | First-person anchor, scene detail, emotional presence, time flow |
| `marketing` | Ad copy, landing pages, product announcements | Short impact sentences, persuasive, CTA-friendly |
| `instructional` | Tutorials, how-to guides, technical docs | Imperative verbs, numbered structure, hedging suppressed |

`--tone auto` runs heuristic detection (lexical + structural signals) and selects the best-fit tone. zh/ja with any tone (including `auto`) emits a warning and falls back to profile-only mode — Phase 4.5b heuristics only cover ko/en.

### MAX mode

Run the same text through Claude, Codex, and Gemini independently. The lowest AI-score result that passes MPS ≥ 70 wins:

```
/patina-max

[paste your text here]
```

## How It Works

```
Input
  ↓
[Step 4.5]   Semantic anchor extraction (claims, polarity, causation, numbers)
[Step 4.6]   Stylometric pre-pass (burstiness CV + MATTR)
[Step 4.7]   AI-lexicon overlap (~108 EN / 102 KO entries)
[Phase 1]    Structure scan + anchor verification
[Phase 2]    Sentence rewrite + anchor verification
[Phase 3]    Self-audit (polarity, regression, MPS)
  ↓
Natural-sounding text (meaning verified)
```

If meaning drifts at any verification step, the change is retried or rolled back.

**Calibration** *(500-paragraph corpus, reproducible via `.omc/research/v3_8_remeasure.py`)*: 76% AI catch on HC3 ChatGPT (en), 91% on paired ko/AI corpus, 13–25% FP on human prose. Acceptance gates: AI ≥ 75%, max FP ≤ 25%. See [stylometry.md](core/stylometry.md) for the algorithm.

## Configuration

```yaml
# .patina.default.yaml
version: "3.11.0"
language: ko              # ko | en | zh | ja
profile: default
output: rewrite           # rewrite | diff | audit | score
tone:                     # casual | professional | academic | narrative | marketing | instructional | auto
max-models: [claude, gemini]
```

Pattern packs are auto-discovered by language prefix. `.patina.yaml` in the working directory overrides defaults.

## Documentation

- **[Patterns](docs/PATTERNS.md)** — full 146-pattern catalog
- **[Authentication](docs/AUTHENTICATION.md)** — backends, providers, free-tier setup
- **[FAQ](docs/FAQ.md)** — detector-bypass concerns, MPS, false positives, contribution starting points
- **[Roadmap](docs/ROADMAP.md)** — quality, benchmark, product, community, and launch priorities
- **[Benchmark Report](docs/benchmarks/latest.md)** — latest reproducible suspect-zone benchmark summary
- **[AI/Human Metrics Research](docs/research/ai-human-metrics.md)** — benchmark design notes for measuring AI-like writing signals
- **[Launch Copy](docs/social/patina-launch-copy.md)** — Show HN, Reddit, X, Korean community drafts
- **[Stylometry](core/stylometry.md)** — burstiness + MATTR + AI-lexicon algorithm
- **[Scoring](core/scoring.md)** — AI-likeness + fidelity + MPS
- **[Changelog](CHANGELOG.md)** — release notes and methodology
- **[Contributing](CONTRIBUTING.md)** — pattern submissions, staleness reports

## Acknowledgements

Inspired by [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh)'s plugin architecture (patterns are plugins, profiles are themes), [Wikipedia's "Signs of AI writing"](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) catalog, and [blader/humanizer](https://github.com/blader/humanizer).

## License

MIT
