# Authentication & Backends

patina runs through one of several backends. Pick whichever matches your existing tooling.

## Backend matrix

| Backend | Setup | Cost |
|---------|-------|------|
| `codex-cli` | `codex login` | **Free** (ChatGPT OAuth) |
| `claude-cli` | `claude` (one-time interactive OAuth) | **Free** (Claude subscription) |
| `gemini-cli` | `gemini` (one-time interactive OAuth) or `GEMINI_API_KEY=...` | **Free** (Code Assist OAuth or AI Studio) |
| OpenAI-compatible HTTP | `PATINA_API_KEY=...` | Per provider |
| Google Gemini (HTTP) | `GEMINI_API_KEY=...` + `--provider gemini` | Free tier |
| Groq | `GROQ_API_KEY=...` + `--provider groq` | Free tier |
| Together AI | `TOGETHER_API_KEY=...` + `--provider together` | Free models available |
| OpenRouter | `--base-url https://openrouter.ai/api/v1` + key | Per provider (mix any provider) |

```bash
patina auth status         # backend availability + auth state
patina auth login          # per-backend login instructions
patina --list-providers    # preset providers + key status
```

Backend selection requires an explicit signal: pass `--backend <name>` directly, pass a comma-separated fallback chain such as `--backend claude-cli,codex-cli`, or use `--model <prefix>` (`codex-*`, `claude-*`, `gemini-*` route to the matching local CLI). With no flags and no API key, patina exits with an error rather than silently dispatching to a coding agent. See [issue #88](https://github.com/devswha/patina/issues/88) for the rationale.

## Environment variables

```bash
PATINA_API_KEY=...                            # required for HTTP backend
PATINA_API_BASE=https://api.openai.com/v1     # or proxy / OpenRouter / etc.
PATINA_MODEL=gpt-4o                           # default model
```

`--base-url`, `--model`, `--api-key`, `--provider` flags override these per run.

## codex-cli backend

patina dispatches via the local [`codex`](https://github.com/openai/codex) CLI, which authenticates via OpenAI/ChatGPT OAuth — no API key needed.

```bash
codex login                                # one-time
patina --backend codex-cli --lang ko input.txt
patina --model codex --lang ko input.txt   # same — auto-routes by model name
```

## claude-cli backend

Spawns local [`claude`](https://docs.anthropic.com/en/docs/claude-code) `-p` with the patina prompt on stdin. Free for anyone with a Claude subscription.

```bash
claude                                     # one-time interactive OAuth
patina --backend claude-cli --lang ko input.txt
patina --model claude-sonnet-4-6 --lang ko input.txt   # auto-routes
```

Auth file: `~/.claude/.credentials.json` (created by the OAuth flow).

## gemini-cli backend

Spawns local [`gemini`](https://github.com/google-gemini/gemini-cli) `-p '' --output-format text` with the patina prompt on stdin. Works with the free Code Assist OAuth tier or with `GEMINI_API_KEY`.

```bash
gemini                                     # one-time interactive OAuth, OR
export GEMINI_API_KEY="..."                # AI Studio key
patina --backend gemini-cli --lang ko input.txt
patina --model gemini-3-flash-preview --lang ko input.txt   # auto-routes
```

Notes: patina passes `--skip-trust` because the prompt runs from a fresh temp directory (containment for prompt-injection in user text). Default timeout is higher than other CLIs because gemini's startup latency is longer.

> **v1 limitation:** `codex-cli`, `claude-cli`, and `gemini-cli` all support single-mode rewrites only. `--audit`, `--score`, `--diff`, `--ouroboros`, and `--models`/MAX still go through the HTTP backend.

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
