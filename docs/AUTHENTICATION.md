# Authentication & Backends

patina runs through one of several backends. Pick whichever matches your existing tooling.

## Backend matrix

| Backend | Setup | Cost |
|---------|-------|------|
| `codex-cli` | `codex login` | **Free** (ChatGPT OAuth) |
| `claude-cli` | `claude auth login` (one-time interactive OAuth) | **Free** (Claude subscription) |
| `gemini-cli` | `gemini` (one-time interactive OAuth) or `GEMINI_API_KEY=...` | **Free** (Code Assist OAuth or AI Studio) |
| OpenAI-compatible HTTP | `PATINA_API_KEY=...` | Per provider |
| Google Gemini (HTTP) | `GEMINI_API_KEY=...` + `--provider gemini` | Free tier |
| Groq | `GROQ_API_KEY=...` + `--provider groq` | Free tier |
| Together AI | `TOGETHER_API_KEY=...` + `--provider together` | Free models available |
| OpenRouter | `--base-url https://openrouter.ai/api/v1` + key | Per provider (mix any provider) |

```bash
patina auth status         # backend availability + auth state
patina auth login          # per-backend login instructions
patina auth login codex-cli # confirm, then run `codex login`
patina --list-providers    # preset providers + key status
```

Backend selection requires an explicit signal: pass `--backend <name>` directly, pass a comma-separated fallback chain such as `--backend claude-cli,codex-cli`, or use `--model <prefix>` (`codex-*`, `claude-*`, `gemini-*` route to the matching local CLI). With no flags and no API key, patina exits with an error rather than silently dispatching to a coding agent. See [issue #88](https://github.com/devswha/patina/issues/88) for the rationale.

## Environment variables

```bash
PATINA_API_KEY=...                            # required for HTTP backend
PATINA_API_BASE=https://api.openai.com/v1     # or proxy / OpenRouter / etc.
PATINA_MODEL=gpt-4o                           # default model
```

`--base-url`, `--model`, `--api-key-file`, and `--provider` flags override these per run.

## codex-cli backend

patina dispatches via the local [`codex`](https://github.com/openai/codex) CLI, which authenticates via OpenAI/ChatGPT OAuth — no API key needed.

```bash
codex login                                # one-time
patina auth login codex-cli                # same, with confirmation
patina --backend codex-cli --lang ko input.txt
patina --model codex --lang ko input.txt   # same — auto-routes by model name
```

## claude-cli backend

Spawns local [`claude`](https://docs.anthropic.com/en/docs/claude-code) `-p` with the patina prompt on stdin. Free for anyone with a Claude subscription.

```bash
claude auth login                          # one-time interactive OAuth
patina auth login claude-cli               # same, with confirmation
patina --backend claude-cli --lang ko input.txt
patina --model claude-sonnet-4-6 --lang ko input.txt   # auto-routes
```

Auth file: `~/.claude/.credentials.json` (created by the OAuth flow).

## gemini-cli backend

Spawns local [`gemini`](https://github.com/google-gemini/gemini-cli) `-p '' --output-format text` with the patina prompt on stdin. Works with the free Code Assist OAuth tier or with `GEMINI_API_KEY`.

```bash
gemini                                     # one-time interactive OAuth, OR
patina auth login gemini-cli               # same, with confirmation
export GEMINI_API_KEY="..."                # AI Studio key
patina --backend gemini-cli --lang ko input.txt
patina --model gemini-3-flash-preview --lang ko input.txt   # auto-routes
```

Use `--yes` only for automation where the launch is already intentional:

```bash
patina auth login codex-cli --yes
```

Notes: patina passes `--skip-trust` because the prompt runs from a fresh temp directory (containment for prompt-injection in user text). Default timeout is higher than other CLIs because gemini's startup latency is longer.

> **Mode support:** `codex-cli`, `claude-cli`, and `gemini-cli` can be used as rewrite backends without `PATINA_API_KEY` when their local CLIs are already authenticated. API-backed score/audit paths still use the configured HTTP/evaluator key.

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

`--provider` sets the right base URL, default model, and reads the provider-specific API key env var. Override these with `--base-url`, `--model`, or `--api-key-file`.

