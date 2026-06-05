# 인증과 백엔드

patina는 여러 백엔드 가운데 하나로 실행됩니다. 지금 쓰는 도구와 인증 방식에 맞춰 고르면 됩니다.

## Backend matrix

| Backend | Setup | Cost |
|---------|-------|------|
| `codex-cli` | `codex login` | **Free** (ChatGPT OAuth) |
| `claude-cli` | `claude auth login` (one-time interactive OAuth) | **Free** (Claude subscription) |
| `gemini-cli` | `gemini` (one-time interactive OAuth) or `GEMINI_API_KEY=...` | **Free** (Code Assist OAuth or AI Studio) |
| `kimi-cli` | `kimi login` (one-time browser OAuth) or `KIMI_API_KEY=...` | Kimi account / Moonshot API |
| OpenAI-compatible HTTP | `PATINA_API_KEY=...` | Per provider |
| Google Gemini (HTTP) | `GEMINI_API_KEY=...` + `--provider gemini` | Free tier |
| Groq | `GROQ_API_KEY=...` + `--provider groq` | Free tier |
| Kimi / Moonshot (HTTP) | `KIMI_API_KEY=...` + `--provider kimi`, 또는 `MOONSHOT_API_KEY=...` + `--provider moonshot` | Per provider |
| Together AI | `TOGETHER_API_KEY=...` + `--provider together` | Free models available |
| OpenRouter | `--base-url https://openrouter.ai/api/v1` + key | Per provider (mix any provider) |

```bash
patina auth status         # backend availability + auth state
patina auth login          # per-backend login instructions
patina auth login codex-cli # confirm 후 `codex login` 실행
patina --list-backends     # backend selector와 auth 상태
```

백엔드는 명시적으로 골라야 합니다. `--backend <name>`을 직접 넘기거나, `--backend claude-cli,codex-cli`처럼 우선순위를 적거나, `--model <prefix>`를 쓰세요. `codex-*`, `claude-*`, `gemini-*`, `kimi-*`는 각각 해당 CLI로 연결됩니다. 아무 플래그도 없고 API 키도 없으면 patina는 다른 에이전트로 몰래 넘기지 않고 바로 오류로 끝납니다. 배경은 [issue #88](https://github.com/devswha/patina/issues/88)를 보면 됩니다.

## Environment variables

```bash
PATINA_API_KEY=...                            # required for HTTP backend
PATINA_API_BASE=https://api.openai.com/v1     # or proxy / OpenRouter / etc.
PATINA_MODEL=gpt-5.5                           # HTTP/OpenAI default model
```

`--base-url`, `--model`, `--api-key-file`, `--provider` 플래그는 그 실행에 한해서 이 값을 덮어씁니다.
`--model`을 따로 주지 않으면 patina는 백엔드마다 문서에 적어 둔 기본 모델을 씁니다. OpenAI HTTP와 `codex-cli`는 `gpt-5.5`, `claude-cli`는 `claude-sonnet-4-6`, Gemini HTTP/CLI는 `gemini-2.5-pro`, `kimi-cli`는 `kimi-code/kimi-for-coding`, Kimi/Moonshot HTTP는 `kimi-k2.5`입니다. `--model codex`, `--model claude`, `--model gemini`, `--model kimi` 같은 별칭도 각 CLI로 라우팅되지만 실제로 넘기는 값은 그 백엔드의 기본 모델입니다.

## codex-cli backend

patina는 로컬 [`codex`](https://github.com/openai/codex) CLI로 요청을 보냅니다. 이 CLI는 OpenAI/ChatGPT OAuth로 인증하므로 API 키가 필요 없습니다. `codex exec`에 기본으로 넘기는 모델은 `gpt-5.5`이고, 더 구체적인 Codex 모델 ID를 직접 주면 그 값을 그대로 씁니다.

```bash
codex login                                # one-time
patina auth login codex-cli                # same, with confirmation
patina --backend codex-cli --lang ko input.txt
patina --model codex --lang ko input.txt   # codex-cli로 라우팅하고 gpt-5.5 기본값 사용
```

## claude-cli backend

로컬 [`claude`](https://docs.anthropic.com/en/docs/claude-code) `-p`에 patina 프롬프트를 stdin으로 넘겨 실행합니다. Claude 구독이 있으면 추가 API 키 없이 쓸 수 있습니다. Claude Code는 agent runtime이므로 batch 모드에서는 보수적으로 다룹니다: compact prompt mode, 기본 동시성 `1`, 기본 retry `0`. 기본 모델은 `claude-sonnet-4-6`이지만, Claude Code 자체의 모델/세션 정책은 patina가 완전히 통제하지 못할 수 있습니다.

```bash
claude auth login                          # one-time interactive OAuth
patina auth login claude-cli               # same, with confirmation
patina --backend claude-cli --lang ko input.txt
patina --model claude-sonnet-4-6 --lang ko input.txt   # auto-routes
```

인증 파일: `~/.claude/.credentials.json` (OAuth 로그인 뒤 생성됩니다).

## gemini-cli backend

로컬 [`gemini`](https://github.com/google-gemini/gemini-cli) `-p '' --output-format text`에 patina 프롬프트를 stdin으로 넘겨 실행합니다. 무료 Code Assist OAuth tier나 `GEMINI_API_KEY`로 쓸 수 있고, 기본 모델은 `gemini-2.5-pro`입니다.

```bash
gemini                                     # one-time interactive OAuth, OR
patina auth login gemini-cli               # same, with confirmation
export GEMINI_API_KEY="..."                # AI Studio key
patina --backend gemini-cli --lang ko input.txt
patina --model gemini-3-flash-preview --lang ko input.txt   # auto-routes
```

## kimi-cli backend

로컬 [`kimi`](https://moonshotai.github.io/kimi-cli/)를 print mode로 실행하고 patina 프롬프트를 stdin으로 넘깁니다. Kimi Code CLI 브라우저 로그인이나 `KIMI_API_KEY`, `MOONSHOT_API_KEY` 중 하나로 인증할 수 있습니다. Kimi Code는 agent runtime이므로 batch 모드에서는 보수적으로 다룹니다: compact prompt mode, 기본 동시성 `1`, 기본 retry `0`. 로컬 CLI 기본 모델은 `kimi-code/kimi-for-coding`이며, CLI 표시 이름은 Moonshot HTTP 모델 ID와 다를 수 있습니다.

```bash
kimi login                                  # one-time browser OAuth, OR
patina auth login kimi-cli                  # same, with confirmation
export KIMI_API_KEY="..."                   # optional API key path
patina --backend kimi-cli --lang ko input.txt
patina --model kimi --lang ko input.txt     # kimi-cli로 라우팅하고 backend 기본값 사용
```

자동화에서는 이미 실행 의도가 분명할 때만 `--yes`를 쓰세요.

```bash
patina auth login codex-cli --yes
```

참고: patina는 사용자 텍스트 안의 prompt injection 영향을 줄이려고 새 임시 디렉터리에서 프롬프트를 실행하고 `--skip-trust`를 함께 넘깁니다. gemini는 시작이 느린 편이라 기본 timeout도 다른 CLI보다 더 길게 잡혀 있습니다.

> **지원 범위:** `codex-cli`, `claude-cli`, `gemini-cli`, `kimi-cli`는 로컬 CLI 로그인만 되어 있으면 `PATINA_API_KEY` 없이 rewrite 백엔드로 쓸 수 있습니다. 반면 API 기반 score/audit 경로는 계속 설정된 HTTP/evaluator 키를 사용합니다.

대량 rewrite batch는 가능한 한 로컬 agent CLI보다 `openai-http` 같은 stateless
OpenAI-compatible HTTP provider를 쓰세요. Batch 모드는 `--timeout-ms`,
`--max-concurrency`, `--max-retries`, `--max-failures`,
`--max-failure-rate`, `--stop-on-retryable-storm`을 제공합니다. 자세한 내용은
[CLI.md](CLI.md#batch-safety-controls)를 보세요.

## HTTP provider examples

호출할 프로바이더에 맞는 API 키를 준비한 뒤 아래처럼 실행하면 됩니다.

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

# Kimi / Moonshot (paid API)
export KIMI_API_KEY="..."
patina --provider kimi --lang ko input.txt

export MOONSHOT_API_KEY="..."
patina --provider moonshot --lang ko input.txt
```

`--provider`를 쓰면 맞는 base URL과 기본 모델이 자동으로 잡히고, 그 프로바이더에 해당하는 API 키 환경변수도 함께 읽습니다. 필요하면 `--base-url`, `--model`, `--api-key-file`로 각각 덮어쓸 수 있습니다.

