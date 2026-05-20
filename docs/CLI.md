# CLI Contract

patina's CLI is optimized for interactive editing, but a few surfaces are stable enough for automation.

## Score gate

Use `--score --gate <n>` when CI should fail if a text still reads too AI-like.

```bash
patina --lang en --score --gate 30 draft.md
```

- `--score` still prints the model's score output.
- If the parsed `overall` score is greater than the gate, patina prints a `[patina] score gate failed` warning to stderr and exits with code `3`.
- The gate is intentionally limited to `--score`; rewrite/audit/diff modes should not fail a pipeline based on an output shape they do not own.

## Exit codes

| Code | Meaning |
|---:|---|
| `0` | Command completed; for `--score --gate`, the score was at or below the gate. |
| `1` | Runtime or backend error, including API/auth/backend failures. |
| `2` | Input/usage error from no interactive input or empty stdin. |
| `3` | `--score --gate` completed, but the score exceeded the configured gate. |

## Current machine-readable surfaces

- `--score` asks the backend to emit a JSON-like score with an `overall` field; `--gate` parses that field for exit-code decisions.
- `--save-run <dir>` writes `manifest.json` plus `output-N.txt` files for reproducible audit trails.
- `--list-backends` and `--list-providers` print tabular status for auth/debugging.

Future output-format work should keep these contracts backward-compatible instead of changing existing stdout by surprise.
