# Exit Codes

patina uses stable exit codes so CI and editor integrations can distinguish content gates from setup failures.

| Code | Meaning |
|---:|---|
| `0` | Success. For `--score --exit-on <n>`, the parsed `overall` score was at or below the threshold. |
| `1` | Runtime/backend failure: API/auth/backend errors, failed doctor blockers, invalid runtime setup, or unexpected exceptions. |
| `2` | Input/usage failure: unknown flags, missing required option values, empty stdin, or `--no-interactive` with no input. |
| `3` | Score gate exceeded. `--score --exit-on <n>` completed, but `overall > n`. |
| `4` | Meaning-safety failure: verification failed, cleanup changed the verified text, a source number was dropped, or a numeric claim changed. Stdout keeps the candidate for review; unsafe source-file writes are blocked. |
| `130` | Interrupted (SIGINT / Ctrl-C). |

Codes are merged with `Math.max` when more than one applies, so a run that both
exceeds a score gate and hits a runtime error reports the stricter code.

> A backend subprocess exiting `75` (`EX_TEMPFAIL`) is a *retryable storm* signal
> that batch mode acts on internally; it is not a patina exit code.

## Meaning-safety exit (exit `4`)

These checks in the rewrite path raise exit `4`:

| Trigger | Fails when |
|---|---|
| `--verify` floor | after the rewrite and one conservative retry, no candidate reaches `verification.mps-floor` / `verification.fidelity-floor` (defaults 70); stderr shows `[patina] verify: MPS …, fidelity … (below floor)` |
| verified output changed | cleanup changes the text after verification; the scores no longer cover the emitted candidate |
| dropped-number guard | a number present in the source is missing from the rewrite (`droppedNumbers`), with or without `--verify` |
| numeric-claim overlay | the rewrite changes a numeric claim the web number-safety gate rejects — sign flip (`-5`→`5`), word-number drift (`one`→`two`), an added numeric claim, or a collapsed duplicate — while keeping the source digits (`assessRewriteMeaningSafety` → `numeric-claim-changed`). Vanished digits still report `dropped-numbers`. Unsupported scientific syntax (`p < 0.05`) stays web-only and never fails the CLI. Preview candidates (`--preview`, including compare variants) enforce the same overlay while still rendering the page |

With stdout output, patina still prints the candidate and warns on stderr for
review. With `--batch --in-place`, a failed candidate leaves its source file
unchanged and produces no `Written:` success message. Separate `--suffix` and
`--outdir` outputs remain available for review, unless the destination refers to
any batch input (including symbolic or hard links). This protects both pending
and already processed source files.

Each failed batch item counts against the failure budget, even when its
candidate is emitted for review. Later valid files can still be written within
that budget. The batch summary counts failures separately from successes, and
the run retains exit `4` after later successful files or a batch summary error.

```bash
patina --lang ko draft.md; echo "exit=$?"   # exit=4 when a year or figure vanished
```

Because MPS/fidelity come from a model call, the `--verify` trigger is not
deterministic across runs of the same input; the dropped-number guard and the
numeric-claim overlay are.
Suppressing stderr with `--quiet` hides the reason but does not change the
exit code.

Persona voice-match and surface-churn results are **advisory only**: they warn
on stderr and never change the exit code.

## Score gates

```bash
patina --lang en --score --exit-on 30 draft.md
```

`--exit-on <n>` prints the score output as usual; only the process exit code changes to `3` when the threshold fails.

## Empty input

- Piped empty or whitespace-only stdin exits `2` and prints a three-line `[patina] Error:` message.
- In an interactive TTY, patina prompts for one-shot stdin and waits until Ctrl-D.
- `--no-interactive` restores script-safe no-input behavior: no prompt, exit `2`.
