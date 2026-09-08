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
  <a href="CHANGELOG.md"><img alt="Version 8.5.2" src="https://img.shields.io/badge/version-8.5.2-blue"></a>
</p>

<p align="center">
  <a href="https://patina.vibetip.help/?lang=en&amp;utm_source=github&amp;utm_campaign=multilingual-20260907"><b>Try it in the browser — no install</b></a>
</p>

**An illustrative email edit**

**Before**

> I'm writing to let you know that the launch review is scheduled for Friday at 2 p.m. The draft is 6 pages long, and two questions about pricing are still open.

**After**

> The launch review is Friday at 2 p.m. The draft has 6 pages and two open pricing questions.

A curated excerpt from [the English email showcase](playground/examples/en.js). This is a synthetic example, not a live run or a measured score.

patina is a deterministic, pattern-based humanizer for Korean, English, Chinese, and Japanese. It finds AI-sounding phrasing and rewrites it **without changing the claim, numbers, polarity, or causation** — built for allowed AI-assisted drafting, not for evading detectors.

- **Auditable, not a black box** — 184 named patterns drive every edit; `--diff` shows exactly what changed and why.
- **Meaning verified on the web** — web gates each rewrite with MPS/fidelity floors, rejecting drift; CLI `--verify` and `/patina --strict` add checks.
- **Three independent axes** — Document Type owns genre, Persona owns voice, Register owns delivery. Omit any axis to preserve the source.
- **Every surface** — agent skill (Claude Code · Codex · Cursor · OpenCode), Node CLI, and a [browser playground](https://patina.vibetip.help/?lang=en&utm_source=github&utm_campaign=multilingual-20260907).
- **Honest about limits** — scores are editing signals, not authorship proof; our own [pre-registered study](docs/research/2026-rewrite-efficacy-study1.md) publishes where rewriting fails alongside where it works.

## Quick Start

**Source and web version: 8.5.2.** npm publication is pending; the registry currently serves 8.3.0. Use this checkout with `npm ci` and `node bin/patina.js` for the new CLI commands. See [release channels](docs/integrations/release.md).

**Browser — nothing to install.** Open **[patina.vibetip.help](https://patina.vibetip.help/?lang=en&utm_source=github&utm_campaign=multilingual-20260907)** and paste text. Rewrites run server-side with the MPS/fidelity gates; API mode forwards your own key per request (never stored or logged).

[Hosted API (Pro)](docs/HTTP-API.md)

[Aside blog workflow preview](docs/integrations/aside.md): choose local Patina options, then run a verified CLI rewrite before completing a blog draft. Native Aside desktop validation remains separate.

**Agent skill — paste this into Claude Code, Codex CLI, Cursor, or any agent:**

```text
Install patina by following https://raw.githubusercontent.com/devswha/patina/main/INSTALLATION.md
```

Then use it:

```text
/patina --lang en

[paste your text here]
```

**CLI — Node >= 18:**

```bash
npx patina-cli --lang en input.txt          # rewrite
npx patina-cli doctor                       # check backends and keys
```

A logged-in `codex`, `claude`, or `gemini` CLI works with no API key: add `--backend codex-cli`. Full install options: [INSTALLATION.md](INSTALLATION.md).

## Three Independent Axes

patina does not infer one axis from another. Omit Persona and Register to keep the source voice and register.

| Axis | Controls | Does not control | Select with |
|---|---|---|---|
| **Document Type** | Genre, purpose, structural conventions, pattern policy | Voice, casual/professional delivery, meaning floors | `--document-type` · config `document-type` · Playground "Document Type" |
| **Persona** | Reusable voice fingerprint: vocabulary, rhythm, explanation habits | Genre, pattern policy, register, meaning floors | `--persona` · config `persona` · Playground "Persona" |
| **Register** | `casual` or `professional` delivery | Genre, persona identity, pattern policy | `--register` · config `register` · Playground "Register" |

Meaning preservation is the outer guard; an explicit value never fills an omitted axis.

## Commands

```bash
patina input.txt                                          # rewrite with defaults
patina --audit input.txt                                  # detect patterns only
patina --score --offline --exit-on 30 input.txt           # deterministic CI gate, no API key
patina --diff input.txt                                   # pattern-by-pattern changes
patina --verify input.txt                                 # rewrite + MPS/fidelity floor check
patina --document-type email --register professional input.txt
patina persona new my-voice --from-sample past-posts.txt  # learn a reusable voice
patina --persona my-voice draft.md
patina --batch docs/*.md --outdir cleaned/
```

`patina --help` prints the full flag list. CI wrapper for GitHub Actions: [devswha/patina-action](https://github.com/devswha/patina-action) — plus [pre-commit, static-site, Docker, and release integrations](docs/integrations/pre-commit.md).

Editor clients: the VS Code, Obsidian and Gmail preview clients are retired. See the [historical record](docs/integrations/editors.md).

Model evidence: [writing/scoring guide (Korean)](docs/research/model-guide-20260905.md), [rewrite confirmation](docs/research/model-rewrite-confirmation-20260905.md), and [live scoring diagnostics](docs/benchmarks/live-rebaseline-20260905.md).

Project config lives in `.patina.yaml`:

```yaml
version: "8.5.2"
language: ko              # ko | en | zh | ja
document-type: default    # genre/purpose + pattern policy
persona:                  # optional reusable voice; omit to preserve source
register:                 # casual | professional; omit to preserve source
```

## Facts

|  |  |
|---|---|
| **184 patterns** | 37 rewrite-capable + 9 score-only viral-hook per language (46 each across KO/EN/ZH/JA) — see the full 184-pattern catalog in [PATTERNS.md](docs/PATTERNS.md) |
| **Modes** | rewrite · verify · audit · score · diff |
| **Calibration** | 67.3% editing-hotspot catch [63.5–71.0%] across GPT-5.5 / Claude Sonnet 4.6 / Gemini 2.5 Pro (n=600, KO+EN); 16.0% false positives [11.6–21.7%] on KO+EN human controls (n=200) |
| **License** | MIT |

Scores are editing signals with false positives and false negatives, not proof of authorship. See [Ethics](docs/ETHICS.md).

## Documentation

[Historical English playground recording](https://raw.githubusercontent.com/devswha/patina/main/assets/demo/patina-demo-live-en.gif) · [recording context](assets/demo/README.md). The recording is an earlier run, separate from the curated examples above.

- [Cookbook](docs/COOKBOOK.md) — common recipes · [CLI contract](docs/CLI.md) — flags, gates, exit codes
- [Before/After gallery](docs/EXAMPLES.md) ([한국어](docs/EXAMPLES_KR.md)) · [Pattern catalog](docs/PATTERNS.md)
- [Architecture](docs/ARCHITECTURE.md) · [Configuration & authentication](docs/AUTHENTICATION.md)
- [Benchmarks](docs/benchmarks/latest.md) · [Research](docs/research/2026-rewrite-efficacy-study1.md) · [FAQ](docs/FAQ.md) ([한국어](docs/FAQ_KR.md))
- [Contributing](CONTRIBUTING.md) ([한국어](CONTRIBUTING_KR.md)) · [Changelog](CHANGELOG.md)

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Inspired by [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh), [Wikipedia's "Signs of AI writing"](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), and [blader/humanizer](https://github.com/blader/humanizer).
