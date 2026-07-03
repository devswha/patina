<p align="center">
  <img src="assets/brand/patina-mark.svg" alt="patina mark" width="172">
</p>

<h1 align="center">patina</h1>

<p align="center">
  <strong>Strip the AI packaging. Keep the meaning.</strong>
</p>

<p align="center">
  <a href="README_KR.md"><b>한국어</b></a> ·
  <a href="README_ZH.md"><b>中文</b></a> ·
  <a href="README_JA.md"><b>日本語</b></a> ·
  <b>English</b>
</p>

<p align="center">
  <a href="https://github.com/devswha/patina/actions/workflows/test.yml"><img alt="Tests" src="https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg"></a>
  <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>
  <a href="#quick-start"><img alt="Skill: Claude Code | Codex | Cursor | OpenCode" src="https://img.shields.io/badge/Skill-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%20OpenCode-blueviolet"></a>
  <a href="https://github.com/devswha/patina"><img alt="Languages: KO | EN | ZH | JA" src="https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green"></a>
  <a href="CHANGELOG.md"><img alt="Version 6.1.0" src="https://img.shields.io/badge/version-6.1.0-blue"></a>
</p>

<p align="center">
  <a href="https://patina.vibetip.help/"><b>Try it in the browser — no install</b></a>
</p>

patina is a deterministic, pattern-based humanizer for Korean, English, Chinese, and Japanese. It finds AI-sounding phrasing and rewrites it without changing the claim, numbers, polarity, or causation.

It is not a black-box paraphraser, authorship detector, or detector-bypass tool. patina is built for allowed AI-assisted drafting where the author wants cleaner voice, an audit trail, and meaning-preservation checks.

## Demo

Paste AI-sounding text into the **[playground](https://patina.vibetip.help/)** and patina rewrites it in place. The meaning floors verify the rewrite (**MPS 100 / Fidelity 75** here — the "30 templates" fact survives), and the deterministic AI signal is measured before → after: the hot-paragraph ratio falls **100 → 0** while the hype ("thrilled to announce", "revolutionize your workflow", "unlock their full potential") is gone.

<p align="center">
  <img src="https://raw.githubusercontent.com/devswha/patina/main/assets/demo/patina-playground-en.gif" alt="Animated patina playground demo: an AI-sounding template-pack announcement is pasted into the web playground, rewritten naturally while keeping the 30-templates fact, and verified with MPS 100, Fidelity 75, and a deterministic AI-signal drop from 100 to 0" width="820">
</p>

More examples: [Before/After Gallery](docs/EXAMPLES.md) ([한국어](docs/EXAMPLES_KR.md)) · [CLI transcript](docs/DEMO.md).

## Quick Start

### Browser playground

Open **[patina.vibetip.help](https://patina.vibetip.help/)** — paste KO / EN / ZH / JA text for a real rewrite gated by the MPS/fidelity floors, with the deterministic AI signal measured before → after. Rewrites and scoring run server-side; the free tier uses the service's own model key (rate-limited). **API mode** forwards your own key per request through the patina server to the provider you pick — never stored or logged (metrics are sanitized: no text, prompt, output, key, or IP).

### Agent skill

**Claude Code — plugin marketplace (no clone, recommended):**

```text
/plugin marketplace add devswha/patina
/plugin install patina@patina
```

**Claude Code · Codex CLI · Cursor · OpenCode — install script:**

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

Then run the skill from Claude Code, Codex CLI, Cursor, or OpenCode:

```text
/patina --lang en

[paste your text here]
```

Useful skill calls:

```text
/patina --tone professional
/patina --tone auto --lang en
```

### Standalone CLI

Requires Node.js >= 18.

```bash
npx patina-cli doctor
npx patina-cli --lang en input.txt
```

Use a logged-in local model CLI without an API key:

```bash
printf '%s\n' 'Coffee has emerged as a pivotal cultural phenomenon.' \
  | npx patina-cli --lang en --backend codex-cli
```

Supported local backends: `codex-cli`, `claude-cli`, `gemini-cli`, `kimi-cli` — patina passes the strongest documented default model per backend. See [Authentication](docs/AUTHENTICATION.md) ([한국어](docs/AUTHENTICATION_KR.md)).

For large `--batch` runs, prefer an OpenAI-compatible HTTP backend; local CLI backends are agent runtimes, capped conservatively with `--timeout-ms`, `--max-concurrency`, `--max-retries`, and `--max-failures` for batch safety.

## What You Get

|  |  |
|---|---|
| **168 patterns** | 33 rewrite-capable + 9 score-only viral-hook per language (42 each across KO/EN/ZH/JA) — see the full 168-pattern catalog in [PATTERNS.md](docs/PATTERNS.md) |
| **Modes** | rewrite · verify · audit · score · diff |
| **Surfaces** | agent skill · Node CLI · in-place preview · browser playground (rewrite + score) |
| **Voice** | `--persona` (built-in + your own, ko/en/zh/ja) · `--tone` register · `--profile` genre — composable with a fixed precedence |
| **Free usage** | logged-in `codex`, `claude`, or `gemini` CLI can run rewrites without `PATINA_API_KEY` |
| **Calibration** | 67.3% editing-hotspot catch [63.5–71.0%] across GPT-5.5 / Claude Sonnet 4.6 / Gemini 2.5 Pro (n=600, KO+EN); 16.0% false positives [11.6–21.7%] on KO+EN human controls (n=200) |
| **License** | MIT |

Scores are editing signals with false positives and false negatives, not proof of authorship. See [Ethics](docs/ETHICS.md).

## Common Commands

```bash
patina --lang <ko|en|zh|ja> [mode] [--profile <name>] input.txt
```

| Command | Purpose |
|---|---|
| `patina input.txt` | rewrite with defaults |
| `patina --audit input.txt` | detect patterns only |
| `patina --score input.txt` | output a 0-100 AI-likeness score |
| `patina --score --exit-on 30 input.txt` | CI gate with exit code `3` when `overall > 30` |
| `patina --diff input.txt` | show pattern-by-pattern changes |
| `patina --preview page.html` | render rewrites back onto a saved HTML page with toggles and inline diff |
| `patina --verify input.txt` | rewrite, then check MPS/fidelity floors with one retry |
| `patina --tone auto --lang en input.txt` | infer and apply a KO/EN tone axis |
| `patina --persona pragmatic-founder input.txt` | rewrite in a built-in voice persona |
| `patina persona new my-voice --from-sample past.txt` | author your own persona from a writing sample |
| `patina persona list` | list built-in + custom personas |
| `patina --format json --quiet input.txt` | script-friendly output |
| `patina --batch docs/*.md --outdir cleaned/` | batch file processing |

`patina --help` prints the full flag list. `patina doctor --json` checks Node, backend, tmux, and API-key readiness without making an LLM call.

### Personas (voice)

A **persona** is a reusable voice — a built-in (`patina persona list`) or your own, authored without editing source:

```bash
patina persona new my-voice --from-sample past-posts.txt   # learn from your writing
patina persona new my-voice --describe "plain-spoken founder, casual"
patina --persona my-voice draft.md                          # then reuse it
```

Works on ko/en/zh/ja and composes with `--tone`/`--profile` (register precedence `--tone` > persona > profile). A persona shapes voice but never lowers the meaning floors — authored personas are validated on save, and the safety gate still enforces MPS/fidelity + dropped-number checks.

## CI

For GitHub Actions, the maintained wrapper is shorter than hand-rolled setup:

```yaml
name: Patina prose score
on:
  pull_request:
    paths: ['**/*.md', '**/*.mdx']
permissions:
  contents: read
  pull-requests: read
  issues: write
jobs:
  patina:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: devswha/patina-action@v1
        with:
          score-threshold: 30
          lang: auto
          comment: true
```

Other integrations: [pre-commit](docs/integrations/pre-commit.md), [static sites](docs/integrations/static-sites.md), [Docker](docs/integrations/docker.md), [release workflow](docs/integrations/release.md).

## How It Works

```text
Input
  -> semantic anchor extraction (claims, polarity, causation, numbers)
  -> stylometry + AI-lexicon scan
  -> pattern-guided rewrite
  -> self-audit and MPS/fidelity checks
  -> cleaned text
```

If meaning drifts, the change is retried or rolled back. Deterministic analysis lives in `src/features/*`; LLM-backed rewrite and score calls use the selected backend.

## Configuration

```yaml
# .patina.default.yaml
version: "6.1.0"
language: ko              # ko | en | zh | ja
profile: default
output: rewrite           # rewrite | diff | audit | score
tone:                     # casual | professional | auto  (register; genre = profile)
```

Project `.patina.yaml` overrides defaults. Pattern packs are auto-discovered by language prefix. Additive list keys (`blocklist`, `allowlist`, `skip-patterns`) merge; other arrays replace.

## Documentation

Start here:

- [Cookbook](docs/COOKBOOK.md) — common recipes and workflows
- [CLI Contract](docs/CLI.md) — flags, formats, score gates, exit behavior
- [Authentication](docs/AUTHENTICATION.md) — local CLI backends and API providers
- [Patterns](docs/PATTERNS.md) — full pattern catalog
- [Subagents & strict flow](docs/agents.md) — optional read-only detector/fidelity/naturalness subagents and the `--strict` multi-pass mode
- [Benchmarks](docs/benchmarks/README.md) · [latest report](docs/benchmarks/latest.md) · [2026 rebaseline](docs/research/2026-rebaseline.md)
- [Measurement harness](docs/HARNESS.md) — index of every benchmark, calibration, and gate tool (incl. the signal-impact ablation harness)
- [FAQ](docs/FAQ.md) ([한국어](docs/FAQ_KR.md))
- [Ethics](docs/ETHICS.md)
- [Contributing](CONTRIBUTING.md) ([한국어](CONTRIBUTING_KR.md))
- [Changelog](CHANGELOG.md)

Brand assets and usage rules live in [Branding](docs/BRANDING.md). Design notes live in [DESIGN.md](DESIGN.md).

## Acknowledgements

Inspired by [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh)'s plugin architecture, [Wikipedia's "Signs of AI writing"](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), and [blader/humanizer](https://github.com/blader/humanizer).

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
