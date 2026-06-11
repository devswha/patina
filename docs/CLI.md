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


## Browser diff page

`--browser` is a rewrite-mode add-on for reviewing one local file in the browser without changing stdout semantics.

```bash
patina --browser draft.md
patina --browser --format json draft.md
```

Contract:
- Supports exactly one local file path.
- Rejects stdin, multiple files, `--batch`, URL-like input, and non-rewrite modes such as `--diff`, `--audit`, `--score`, and `--ouroboros`.
- Preserves the normal rewrite stdout output byte-for-byte for the selected `--format`.
- Generates a self-contained local HTML page under an OS temp directory and attempts to open it in the default browser.
- The saved HTML path is always reported on stderr (a headless opener can exit 0 without showing anything); it never appends the path to stdout.
- The page shows side-by-side before/after text, conservative changed-block highlights, deterministic before/after score summaries, and Pattern/Removed/Added/Why explanation from a best-effort secondary diff call.
- `--browser` makes one additional diff-explanation model/backend call after the primary rewrite, so it can add latency and consume extra backend quota.
- If the secondary diff explanation call fails, the rewrite still succeeds and the page shows a failure notice in the explanation area.

### Headless servers: `--serve`

On a machine with no display (SSH, containers), add `--serve` to serve the diff page over HTTP instead of opening a window:

```bash
patina --browser --serve draft.md
```

Contract:
- Requires `--browser`; replaces the window opener (nothing is spawned).
- Binds `127.0.0.1` on a random port and serves only `GET`/`HEAD` of one unguessable token URL (`http://127.0.0.1:<port>/<token>/`); everything else is 404. Responses send `nosniff`, `no-referrer`, and `no-store` headers, and the page keeps its restrictive CSP.
- Prints the URL on stderr. From a remote shell, forward it with `ssh -L <port>:127.0.0.1:<port> <host>`; VS Code/Cursor remote terminals forward localhost URLs automatically.
- Keeps running until 10 minutes pass with no request, then stops on its own; Ctrl-C stops it immediately. The saved HTML file remains either way.


## In-place page preview: `--preview`

`--preview` fetches one http(s) URL, rewrites its prose, and renders the rewrites **in place on a snapshot of the page** — original layout and CSS intact, each rewritten block highlighted and numbered, with a floating bar to count changes, jump between them, and toggle rewritten ↔ original text.

```bash
patina --preview https://example.com/article
patina --preview --serve https://example.com/article   # headless: serve at a token URL
```

Contract:
- Rewrites only plain-text prose blocks (`p`, headings, `li`, `blockquote`, …) with no nested markup; navigation, prices, tables, and mixed-markup paragraphs are left untouched. One rewrite backend call for the whole page.
- The snapshot is inert: scripts are removed (hydration would revert the swapped text), inline event handlers and `javascript:` URLs are neutralized, and a `<base href>` keeps the page's own CSS and images loading.
- Works on server-rendered pages. Client-rendered SPAs ship an empty HTML shell, so there is nothing to extract — patina fails with a clear message instead of showing a blank snapshot.
- If the model returns a different paragraph count than the extracted blocks, the run fails rather than guessing the mapping; re-run or fall back to `patina --browser` on saved text.
- stdout carries the rewritten prose (pipe-safe); the page path and serve URL go to stderr, same as `--browser`.


## Backend fallback chains

`--backend <name>` selects one backend. `--backend a,b,c` selects an explicit
fallback chain and tries each backend in order only for retryable failures:
HTTP `429`, HTTP `503`, and a first-backend `AbortError`. User cancellation via
Ctrl-C stops the chain instead of falling through.

```bash
patina --backend claude-cli,codex-cli --lang en draft.md
```

All backends share the same invocation contract:
`invoke({ prompt, model, modelSource, signal, timeout, maxRetries }): Promise<string>`.
Local CLI backends honor `AbortSignal` by killing their child process. When no
explicit model is set, local backends pass the strongest documented default to
their CLI (`gpt-5.5`, `claude-sonnet-4-6`, `gemini-2.5-pro`, or
`kimi-code/kimi-for-coding`); the HTTP backend bridges the same signal into
fetch.

## Batch safety controls

Batch runs print a preflight safety line before the first request: file count,
backend chain, prompt mode, backend concurrency cap, retry budget, timeout,
worst-case request count, and largest/average prompt size.

Defaults are intentionally conservative:

| Backend | Prompt mode | Max concurrency | Max retries |
|---|---|---:|---:|
| `openai-http` | strict | 4 | 2 |
| `codex-cli` | minimal | 2 | 0 |
| `claude-cli` | minimal | 1 | 0 |
| `gemini-cli` | minimal | 2 | 0 |
| `kimi-cli` | minimal | 1 | 0 |

Local CLIs are agent runtimes, not stateless completion APIs. For large rewrite
batches, prefer an OpenAI-compatible HTTP provider. Override the guardrails only
when you have measured the backend:

```bash
patina --batch --backend openai-http --max-concurrency 4 --max-retries 2 docs/*.md
patina --batch --backend kimi-cli --max-concurrency 1 --max-retries 0 docs/*.md
```

Circuit breakers stop batch mode after repeated failure instead of burning quota:

```bash
patina --batch --max-failures 5 --max-failure-rate 0.25 --stop-on-retryable-storm docs/*.md
patina --batch --timeout-ms 600000 docs/*.md
```

`--max-failure-rate` accepts either a ratio (`0.25`) or a percent (`25`). By
default, batch mode stops after a small failure budget, after a 25% failure rate
once enough files have run, or after repeated retryable storms such as HTTP 429,
timeouts, empty local-CLI responses, or repeated Kimi/Claude process exits.

MDX/frontmatter note: patina does not parse MDX or rewrite YAML frontmatter
schemas. For `.mdx` batches, run your site's MDX/build validator after patina
and keep project-specific guards for frontmatter quoting, trailing model footers,
and JSX hazards such as malformed `<digit` fragments.

See [EXIT-CODES.md](EXIT-CODES.md) for the full process contract.
