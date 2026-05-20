# CLI Contract

patina's CLI is optimized for interactive editing, but a few surfaces are stable enough for automation.

## Score gate

Use `--score --exit-on <n>` (or the older `--gate <n>` alias) when CI should fail if a text still reads too AI-like.

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
| `3` | `--score --exit-on` / `--score --gate` completed, but the score exceeded the configured gate. |
| `4` | MAX mode all candidates failed, or patina fell back because no candidate met the MPS floor. |

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
- `mps` is populated for MAX-mode results when available.
- `gateResult` is `null` unless `--exit-on` / `--gate` is used.
- `--save-run <dir>` writes a schema-v2 `manifest.json` plus `output-N.txt` files for reproducible audit trails. Each result records prompt/response hashes, available token usage, temperature/seed, score details, per-call cost when providers return it, and the Ouroboros iteration log when used.
- `--cache <dir>` or `PATINA_CACHE_DIR` enables an opt-in persistent HTTP response cache keyed by prompt, model, temperature, and API host. `--cache-ttl <sec>` / `PATINA_CACHE_TTL_SECONDS` set expiry, and `--no-cache` forces a fresh run.
- `patina doctor --json` emits setup diagnostics for CI without making an LLM call.

## Stderr logs

Human-facing status, warnings, and progress indicators go to stderr so stdout
stays reserved for the transformed text or JSON envelope.

- `--quiet` suppresses stderr logs, including MAX/Ouroboros progress.
- `--json-logs` emits newline-delimited JSON records with stable fields:
  `ts`, `level`, `event`, `model`, `latency_ms`, and optional `message`.
- MAX mode (`--models`) reports elapsed per-model status (`...`, `✓`, `✗`).
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
`invoke({ prompt, model, signal, timeout }): Promise<string>`. Local CLI
backends honor `AbortSignal` by killing their child process; the HTTP backend
bridges the same signal into fetch.

See [EXIT-CODES.md](EXIT-CODES.md) for the full process contract.
