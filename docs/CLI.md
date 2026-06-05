# CLI Contract

patina's CLI is optimized for interactive editing, but a few surfaces are stable enough for automation.

## Score gate

Use `--score --exit-on <n>` when CI should fail if a text still reads too AI-like.

```bash
patina --lang en --score --exit-on 30 draft.md
```

- `--score` still prints the model's score output.
- If the parsed `overall` score is greater than the gate, patina prints a `[patina] score gate failed` warning to stderr and exits with code `3`.
- The gate is intentionally limited to `--score`; rewrite/audit/diff modes should not fail a pipeline based on an output shape they do not own.

## Exit codes

| Code | Meaning |
|---:|---|
| `0` | Command completed; for `--score --exit-on`, the score was at or below the gate. |
| `1` | Runtime or backend error, including API/auth/backend failures. |
| `2` | Input/usage error from no interactive input or empty stdin. |
| `3` | `--score --exit-on` completed, but the score exceeded the configured gate. |

## Output formats

`--format markdown` is the default and preserves the existing human-readable output. `--format text` emits the same user-facing content without the YAML tone footer. `--format json` wraps every mode in a stable envelope:

```json
{
  "mode": "score",
  "format": "json",
  "overall": 23,
  "categories": [],
  "tone": { "tone": null, "tone_source": "profile_only" },
  "mps": null,
  "gateResult": { "threshold": 30, "overall": 23, "passed": true, "exitCode": 0 },
  "output": "raw model output after patina cleanup"
}
```

- `overall` and `categories[]` are populated when patina can parse them from score JSON or score tables.
- Score JSON may include `scores.llm`, `scores.deterministic`, and `scores.preference` when deterministic shadow scoring is available.
- `mps` is populated when the underlying mode emits it.
- `gateResult` is `null` unless `--exit-on` is used.
- `--voice-sample <path>` or config `voice-sample: <path>` injects the first 1–3 user-written paragraphs into rewrite/Ouroboros prompts as style-only examples of how this person writes. `--profile` / `--tone` still define the outer register; samples refine cadence and texture without importing facts.
- `patina doctor --json` emits setup diagnostics for CI without making an LLM call.

## Stderr logs

Human-facing status, warnings, and progress indicators go to stderr so stdout
stays reserved for the transformed text or JSON envelope.

- `--quiet` suppresses stderr logs, including Ouroboros progress.
- Ouroboros reports per-iteration score movement and latency.



## Backend fallback chains

`--backend <name>` selects one backend. `--backend a,b,c` selects an explicit
fallback chain and tries each backend in order only for retryable failures:
HTTP `429`, HTTP `503`, and a first-backend `AbortError`. User cancellation via
Ctrl-C stops the chain instead of falling through.

```bash
patina --backend claude-cli,codex-cli --lang en draft.md
```

All backends share the same invocation contract:
`invoke({ prompt, model, modelSource, signal, timeout }): Promise<string>`.
Local CLI backends honor `AbortSignal` by killing their child process. When no
explicit model is set, local backends pass the strongest documented default to
their CLI (`gpt-5.5`, `claude-sonnet-4-6`, `gemini-2.5-pro`, or
`kimi-code/kimi-for-coding`); the HTTP backend bridges the same signal into
fetch.

See [EXIT-CODES.md](EXIT-CODES.md) for the full process contract.
