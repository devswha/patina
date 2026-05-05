**[한국어](README_KR.md)** | **[中文](README_ZH.md)** | **[日本語](README_JA.md)** | English

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Skill](https://img.shields.io/badge/Skill-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%20OpenCode-blueviolet)](#quick-start)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-3.9.0-blue)](CHANGELOG.md)

> **Strip the AI packaging. Keep the meaning.**

Detects and rewrites AI writing patterns in Korean, English, Chinese, and Japanese. Runs as a skill for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex), [Cursor](https://cursor.sh), and OpenCode, or as a standalone Node.js CLI.

Unlike a generic paraphraser, patina is **pattern-based and auditable**: it shows what it changed, why it changed it, and whether the original claims were preserved.

## Demo

**Before** *(AI-sounding)*:
> Coffee has emerged as a **pivotal cultural phenomenon** that has **fundamentally transformed** social interactions across the globe. This beloved beverage serves as a catalyst for community building, fosters meaningful connections, and facilitates cross-cultural dialogue.

**After** *(`/patina --lang en` — same claims, AI packaging removed)*:
> Coffee has quietly changed how people meet. Sit across from someone long enough, and something like a real connection tends to form — even between people from very different cultures.

> **MPS = 100** · cultural transformation ✓ · community building ✓ · meaningful connections ✓ · cross-cultural dialogue ✓

More examples: [Before/After Gallery](docs/EXAMPLES.md). Social preview asset: [patina-before-after.svg](assets/social/patina-before-after.svg).

## At a Glance

|  |  |
|---|---|
| **126 patterns** | 32 KO + 31 EN + 31 ZH + 32 JA — see [PATTERNS.md](docs/PATTERNS.md) |
| **AI catch rate** | 91% Korean / 76% English (HC3) |
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

### As a standalone CLI

Requires Node.js ≥ 18.

```bash
git clone https://github.com/devswha/patina.git
cd patina && npm install && npm link
patina --lang en input.txt
```

> 🆓 **No API key required** if you have the [`codex`](https://github.com/openai/codex) CLI logged in. See [AUTHENTICATION.md](docs/AUTHENTICATION.md) for the full backend list.

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
| `--profile <name>` | Tone preset: `blog`, `academic`, `technical`, `formal`, `social`, `email`, `legal`, `medical`, `marketing` |
| `--batch` | Treat positional args as a list of files (e.g. `--batch docs/*.md`) |

`patina --help` for the full flag list.

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
version: "3.9.0"
language: ko              # ko | en | zh | ja
profile: default
output: rewrite           # rewrite | diff | audit | score
max-models: [claude, gemini]
```

Pattern packs are auto-discovered by language prefix. `.patina.yaml` in the working directory overrides defaults.

## Documentation

- **[Patterns](docs/PATTERNS.md)** — full 126-pattern catalog
- **[Authentication](docs/AUTHENTICATION.md)** — backends, providers, free-tier setup
- **[Stylometry](core/stylometry.md)** — burstiness + MATTR + AI-lexicon algorithm
- **[Scoring](core/scoring.md)** — AI-likeness + fidelity + MPS
- **[Changelog](CHANGELOG.md)** — release notes and methodology
- **[Contributing](CONTRIBUTING.md)** — pattern submissions, staleness reports

## Acknowledgements

Inspired by [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh)'s plugin architecture (patterns are plugins, profiles are themes), [Wikipedia's "Signs of AI writing"](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) catalog, and [blader/humanizer](https://github.com/blader/humanizer).

## License

MIT
