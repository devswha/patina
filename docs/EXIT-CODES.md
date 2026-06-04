# Exit Codes

patina uses stable exit codes so CI and editor integrations can distinguish content gates from setup failures.

| Code | Meaning |
|---:|---|
| `0` | Success. For `--score --exit-on <n>`, the parsed `overall` score was at or below the threshold. |
| `1` | Runtime/backend failure: API/auth/backend errors, failed doctor blockers, invalid runtime setup, or unexpected exceptions. |
| `2` | Input/usage failure: unknown flags, missing required option values, empty stdin, or `--no-interactive` with no input. |
| `3` | Score gate exceeded. `--score --exit-on <n>` completed, but `overall > n`. |

## Score gates

```bash
patina --lang en --score --exit-on 30 draft.md
```

`--exit-on <n>` prints the score output as usual; only the process exit code changes to `3` when the threshold fails.

## Empty input

- Piped empty or whitespace-only stdin exits `2` and prints a three-line `[patina] Error:` message.
- In an interactive TTY, patina prompts for one-shot stdin and waits until Ctrl-D.
- `--no-interactive` restores script-safe no-input behavior: no prompt, exit `2`.
