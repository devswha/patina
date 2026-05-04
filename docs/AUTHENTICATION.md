# Authentication & Backends

patina runs through one of several backends. Pick whichever matches your existing tooling.

## Backend matrix

| Backend | Setup | Cost |
|---------|-------|------|
| `codex-cli` *(default when available)* | `codex login` | **Free** (ChatGPT OAuth) |
| OpenAI-compatible HTTP | `PATINA_API_KEY=...` | Per provider |
| Google Gemini | `GEMINI_API_KEY=...` + `--provider gemini` | Free tier |
| Groq | `GROQ_API_KEY=...` + `--provider groq` | Free tier |
| Together AI | `TOGETHER_API_KEY=...` + `--provider together` | Free models available |
| OpenRouter | `--base-url https://openrouter.ai/api/v1` + key | Per provider (mix any provider) |

```bash
patina auth status         # backend availability + auth state
patina auth login          # per-backend login instructions
patina --list-providers    # preset providers + key status
```

If `PATINA_API_KEY` is unset and `codex` is logged in, patina auto-falls back to `codex-cli`.

## Environment variables

```bash
PATINA_API_KEY=...                            # required for HTTP backend
PATINA_API_BASE=https://api.openai.com/v1     # or proxy / OpenRouter / etc.
PATINA_MODEL=gpt-4o                           # default model
```

`--base-url`, `--model`, `--api-key`, `--provider` flags override these per run.

## codex-cli backend

The simplest free path. patina dispatches via the local [`codex`](https://github.com/openai/codex) CLI, which authenticates via OpenAI/ChatGPT OAuth — no API key needed.

```bash
codex login                            # one-time
patina --backend codex-cli --lang ko input.txt
patina --model codex --lang ko input.txt   # same — auto-routes by model name
patina --lang ko input.txt                 # auto-fallback when PATINA_API_KEY unset
```

> **v1 limitation:** `codex-cli` supports single-mode rewrites only. `--audit`, `--score`, `--diff`, `--ouroboros`, and `--models`/MAX still go through the HTTP backend.

## Free-tier providers

Get an API key once, then it's free:

```bash
# Google Gemini — https://aistudio.google.com/app/apikey
export GEMINI_API_KEY="..."
patina --provider gemini --lang ko input.txt

# Groq (free tier with rate limits)
export GROQ_API_KEY="..."
patina --provider groq --lang ko input.txt

# Together AI (free models suffixed with "-Free")
export TOGETHER_API_KEY="..."
patina --provider together --lang ko input.txt
```

`--provider` sets the right base URL, default model, and reads the provider-specific API key env var. Override any of these with `--base-url`, `--model`, or `--api-key`.

## MAX mode dispatch

The Claude Code `/patina-max` skill bypasses HTTP entirely — it dispatches via local CLIs:

| Model | Dispatch | Auth |
|-------|----------|------|
| `claude` | `claude -p` | Claude Code |
| `codex` | `codex exec --skip-git-repo-check --output-last-message` | ChatGPT OAuth |
| `gemini` | `gemini -p '' --output-format text` | Google AI Studio |

No `PATINA_API_KEY` needed for the Claude Code path.

The standalone CLI MAX (`patina --models <list>`) calls models via the same `--base-url` endpoint, so all listed models must be served by that endpoint. To mix providers (OpenAI + Anthropic + Google), point `--base-url` at OpenRouter or another multi-provider gateway.
