# 인증과 백엔드

patina는 여러 backend 중 하나를 통해 실행됩니다. 이미 쓰고 있는 도구에 맞는 방식을 고르세요.

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

Backend selection에는 명시적인 신호가 필요합니다. `--backend <name>`을 직접 넘기거나, `--backend claude-cli,codex-cli`처럼 comma-separated fallback chain을 넘기거나, `--model <prefix>`를 사용하세요. `codex-*`, `claude-*`, `gemini-*`는 각각 맞는 local CLI로 라우팅됩니다. flag도 API key도 없으면 patina는 coding agent로 조용히 보내지 않고 오류로 종료합니다. 이유는 [issue #88](https://github.com/devswha/patina/issues/88)를 참고하세요.

## Environment variables

```bash
PATINA_API_KEY=...                            # required for HTTP backend
PATINA_API_BASE=https://api.openai.com/v1     # or proxy / OpenRouter / etc.
PATINA_MODEL=gpt-4o                           # default model
```

`--base-url`, `--model`, `--api-key`, `--provider` flag는 실행마다 이 값을 덮어씁니다.

## codex-cli backend

patina는 local [`codex`](https://github.com/openai/codex) CLI를 통해 dispatch합니다. 이 CLI는 OpenAI/ChatGPT OAuth로 인증하므로 API key가 필요 없습니다.

```bash
codex login                                # one-time
patina --backend codex-cli --lang ko input.txt
patina --model codex --lang ko input.txt   # same — auto-routes by model name
```

## claude-cli backend

local [`claude`](https://docs.anthropic.com/en/docs/claude-code) `-p`를 실행하고 patina prompt를 stdin으로 넘깁니다. Claude subscription이 있으면 무료로 사용할 수 있습니다.

```bash
claude                                     # one-time interactive OAuth
patina --backend claude-cli --lang ko input.txt
patina --model claude-sonnet-4-6 --lang ko input.txt   # auto-routes
```

Auth file: `~/.claude/.credentials.json` (OAuth flow가 만듭니다).

## gemini-cli backend

local [`gemini`](https://github.com/google-gemini/gemini-cli) `-p '' --output-format text`를 실행하고 patina prompt를 stdin으로 넘깁니다. 무료 Code Assist OAuth tier 또는 `GEMINI_API_KEY`로 동작합니다.

```bash
gemini                                     # one-time interactive OAuth, OR
export GEMINI_API_KEY="..."                # AI Studio key
patina --backend gemini-cli --lang ko input.txt
patina --model gemini-3-flash-preview --lang ko input.txt   # auto-routes
```

Notes: patina는 user text 안의 prompt-injection을 격리하기 위해 새 temp directory에서 prompt를 실행하고 `--skip-trust`를 넘깁니다. gemini는 startup latency가 더 길어 default timeout이 다른 CLI보다 높습니다.

> **Mode support:** `codex-cli`, `claude-cli`, `gemini-cli`는 rewrite worker로 사용할 수 있으며 standalone CLI MAX 후보 생성에도 사용할 수 있습니다. Standalone MAX는 기존 MAX의 후보별 evaluator 동작과 맞춰 local 후보의 평가도 같은 CLI backend로 수행하므로 local-only MAX 실행에는 `PATINA_API_KEY`가 필요 없습니다. MAX 밖의 score/audit 모드는 계속 설정된 HTTP/evaluator 경로를 사용합니다.

## Free-tier providers

API key를 한 번 발급받으면 무료 tier로 사용할 수 있습니다.

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

`--provider`는 알맞은 base URL, default model을 설정하고 provider-specific API key env var를 읽습니다. `--base-url`, `--model`, `--api-key`로 각각 덮어쓸 수 있습니다.

## MAX mode dispatch

Claude Code `/patina-max` skill은 HTTP를 완전히 우회합니다. local CLI로 dispatch합니다.

| Model | Dispatch | Auth |
|-------|----------|------|
| `claude` | `claude -p` | Claude Code |
| `codex` | `codex exec --skip-git-repo-check --output-last-message` | ChatGPT OAuth |
| `gemini` | `gemini -p '' --output-format text` | Google AI Studio |

Claude Code 경로에서는 `PATINA_API_KEY`가 필요 없습니다.

Standalone CLI MAX(`patina --models <list>`)는 더 이상 HTTP-only가 아닙니다. `--models`에는 local CLI backend 이름(`claude-cli`, `codex-cli`, `gemini-cli`), shorthand alias(`claude`, `codex`, `gemini`), 그리고 HTTP model ID를 함께 넣을 수 있습니다. local 항목은 로그인된 CLI backend를 사용하므로 `PATINA_API_KEY`가 필요 없습니다. HTTP 항목은 여전히 선택한 `--base-url` endpoint를 사용하므로, 해당 provider가 그 model ID를 제공해야 합니다. HTTP provider를 섞으려면(OpenAI + Anthropic + Google) `--base-url`을 OpenRouter나 다른 multi-provider gateway로 지정하세요.
