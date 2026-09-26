# CLI Contract

patina's CLI is optimized for interactive editing, but a few surfaces are stable enough for automation.

## Commands

This file is the contract for the rewrite pipeline and its flags. The shipped
subcommands each have their own reference:

| Command | Reference |
|---|---|
| `patina inspect [file]` | [editor inspection](integrations/editor-inspection.md) |
| `patina persona new|list|show|edit|rm` | [`--persona`](#optional-voice-persona---persona) |
| `patina auth status|login`, `patina doctor` | [authentication](AUTHENTICATION.md) |

Run `node bin/patina.js --help` for the authoritative flag list; [flag parity](FLAG-PARITY.md)
records which of those flags the `/patina` skill also exposes.


## Score gate

Use `--score --exit-on <n>` when CI should fail if a text still reads too AI-like.

```bash
patina --lang en --score --exit-on 30 draft.md
```

- `--score` still prints the model's score output.
- If the parsed `overall` score is greater than the gate, patina prints a `[patina] score gate failed` warning to stderr and exits with code `3`.
- The gate is intentionally limited to `--score`; rewrite/audit/diff modes should not fail a pipeline based on an output shape they do not own.

## Exit codes

`0` success · `1` runtime/backend · `2` input/usage · `3` score gate exceeded · `4` meaning-safety exit (`--verify` floor miss, dropped number, or changed numeric claim; rewrite still printed) · `130` interrupted. Full definitions and merge rules: [EXIT-CODES.md](EXIT-CODES.md).

## Internal configuration snapshots

Ordinary `--config <path>` keeps its existing precedence: bundled defaults,
home `.patina.yaml`, project `.patina.yaml`, then the explicit file. Additive
`blocklist`, `allowlist`, and `skip-patterns` arrays are unioned across layers.

The checkout-local skill helper uses internal `--config-snapshot <path>` for
its private, complete captured configuration. This path loads only that YAML
mapping (JSON is supported), without rereading bundled defaults or home/project
config. Absent keys stay absent and captured arrays are not merged again. The
ordinary mapping/retired-key validation and document-type normalization still
apply; missing or invalid snapshots fail without falling back to ambient config.
It cannot be combined with `--config`. This is helper-to-CLI transport, not a
replacement for public `--config`; model/provider/environment resolution remains
native, and implicit models are not converted into explicit model flags.

## Output formats

`--format markdown` is the default human-readable output. `--format text` emits
the same user-facing content without metadata. `--format json` wraps every mode
in a stable envelope:

```json
{
  "mode": "score",
  "format": "json",
  "overall": 23,
  "categories": [],
  "register": null,
  "mps": null,
  "gateResult": { "threshold": 30, "overall": 23, "passed": true, "exitCode": 0 },
  "persona": null,
  "output": "raw model output after patina cleanup"
}
```

- `overall` and `categories[]` are populated when patina can parse them from score JSON or score tables.
- Score JSON may include `scores.llm`, `scores.deterministic`, and `scores.preference` when deterministic shadow scoring is available.
- `mps` is populated when the underlying mode emits it.
- `gateResult` is `null` unless `--exit-on` is used.
- `patina doctor --json` emits setup diagnostics for CI without making an LLM call. It does make two small network requests by default — one `GET /models` against the configured HTTP base URL to confirm the key is accepted (a 401/403 downgrades `openai-http` to `authenticated=no`), and one npm registry lookup for updates. `--no-probe`, `--no-update-check`, or `--offline` skip them; network failures are informational, never blockers.


## Meaning verification: `--verify`

`--verify` folds a meaning-preservation check into the normal rewrite. After the rewrite it scores MPS and fidelity; if either is below the floor (`verification.{mps-floor,fidelity-floor}`, default 70) it runs **one** conservative retry that re-rewrites from the original with a strict meaning-preservation directive. If the retry still misses, patina emits the closest (highest-fidelity) candidate and warns on stderr — fail-closed but non-destructive, so stdout always carries usable text.

```bash
patina --verify draft.md
patina --verify --lang ko --backend codex-cli draft.md
```

- It is a rewrite modifier, not a separate mode: combining it with `--score`, `--audit`, or `--diff` is an input error (those do not rewrite).
- The MPS/fidelity scorers run through the **selected backend**, so `--verify` works with HTTP and local CLI backends alike. Each candidate needs two scoring calls; a conservative rewrite retry adds another rewrite and two scorers. Each scorer can retry an invalid response once at temperature 0.

Verification checks anchor counts, the weighted Polarity + Negation group, and score arithmetic. Fidelity criteria must be integers from 0 to 3; malformed values are rejected without clamping. Any `HARD_FAIL` prevents verification even when both scores exceed 70. Valid zero-anchor MPS remains 100. If verification still fails after the rewrite retry, stdout keeps the closest candidate and the CLI exits 4.

`--verify --format json` adds runtime evidence under `verification`:

```json
{
  "verified": true,
  "mps": 100,
  "fidelity": 100,
  "retried": false,
  "reason": "passed",
  "mpsFloor": 95,
  "fidelityFloor": 95,
  "outputHash": "4be7a7d2111c4062b90b0dc75898ae8e8772325e15cb67488ef651f9e3d179b3"
}
```

`mpsFloor` and `fidelityFloor` report the configured thresholds (95 in this
example). Scores describe the exact graded text, identified by `outputHash`:
SHA-256 of its UTF-8 bytes, with no whitespace or Unicode normalization. The
example hash is for `The service retains 12 audit logs.` without a newline.
An unparseable MPS is `null`. `reason` is `passed`, `passed-on-retry`,
`floor-not-met`, `retry-error`, `dropped-numbers`, `numeric-claim-changed`, or
`output-changed`.
If cleanup changes the graded text, the CLI sets `verified:false`, reports
`output-changed`, and exits 4. The numeric overlay sets `verified:false` and
`reason:"dropped-numbers"` or `reason:"numeric-claim-changed"` even if the
scorers passed. Vanished source digits keep `dropped-numbers`. Sign flips,
0–12 word-number drift, added numeric claims, and collapsed duplicates use
`numeric-claim-changed`. Unsupported scientific syntax (`p < 0.05`) is not a
CLI failure. The draft appears only in
the existing `output` field. Plain output retains its existing body;
JSON without `--verify` has no `verification` field. Automation must check exit
0, `verification.verified === true`, finite scores meeting its required
floors, and `verification.outputHash` matching the exact `output` bytes.
A nonempty `output` or the envelope's legacy `mps` field is not proof.

The Node CLI keeps Persona quality and verification separate. `--verify` uses
`verification.{mps-floor,fidelity-floor}`; `personas.thresholds` contains only
advisory voice-match and surface-churn thresholds.

### Deterministic meaning guard (always on, no LLM)

Every rewrite (with or without `--verify`) runs a cheap deterministic guard that warns on stderr when numbers present in the source go missing from the rewrite. It never blocks output and makes no model calls (length is intentionally not checked — a humanizer legitimately changes length).

## Three independent rewrite axes

These options compose but never imply one another:

| Axis | Input | Runtime asset | Omission |
|---|---|---|---|
| Document Type | `--document-type <name>` / `document-type:` | `document-types/<name>.md` or `custom/document-types/<name>.md` | `default` document policy. Built-ins include `resume`, `personal-statement`, and `project-writeup`; `formal` is proposals/official reports only. |
| Persona | `--persona <name>` / `persona:` | `personas/<lang>/<name>.md` or a custom Persona | preserve source voice |
| Register | `--register casual|professional` / `register:` | delivery directive | preserve source register |

Document Type controls purpose, audience, structure, style, avoidance rules, and
`pattern-overrides`; Persona controls reusable voice; Register controls only
casual/professional delivery. None may change claims, numbers, polarity,
causation, or verification floors. The removed v6 inputs `--profile`, `--tone`,
and `--formality` are rejected rather than aliased.
Meaning and safety remain above all three axes. Apparent conflicts resolve by
field ownership rather than by letting one axis override another wholesale:
Document Type owns structure and domain constraints, Persona owns idiolect and
rhythm, and Register owns casual/professional markers. Explicit axes do not
populate omitted axes.


## Optional voice Persona: `--persona`

`--persona <name>` selects a validated Persona v2 voice fingerprint from
`personas/<lang>/` or a same-id custom Persona. Omitting the option preserves
the source voice in every language.

Built-in libraries:

- ko: `blog-essay`, `natural-ko`, `pragmatic-founder`, `soft-professional`,
  `technical-explainer`
- en: `blog-essay`, `natural-en`, `technical-explainer`
- zh: `blog-essay`, `natural-zh`
- ja: `blog-essay`, `natural-ja`

```bash
patina --lang ko --persona pragmatic-founder draft.md
patina --lang en --persona natural-en draft.md
```

Contract:

| Combination | v2 behavior |
|---|---|
| `patina file` | no Persona; preserve source voice |
| `--persona p file` | apply only Persona `p`'s voice blocks |
| `--lang ko|en|zh|ja --persona p` | use that language's Persona library |
| `--score/--audit/--diff --persona p` | input error; Persona is rewrite-only |
| `--persona p --register casual|professional` | allowed; independent axes |
| `--persona p --document-type blog` | allowed; independent axes |

Persona v2 files are frontmatter-only at runtime. Markdown bodies are
documentation and never enter prompts. Persona fields may define vocabulary,
metaphor preferences, explanation habits, sentence structure, and measurable
voice targets. They may not define Document Type, Register, pattern policy,
verification, MPS/fidelity floors, or rewrite depth.

For `--format json`, rewrite output includes advisory voice-quality metadata
only when a Persona is active:

```json
{
  "persona": {
    "id": "natural-en",
    "thresholds_source": "placeholder",
    "match": 82.4,
    "over_edit_churn": 0.18,
    "gate_result": {
      "pass": true,
      "hardFailures": [],
      "safetyFailures": [],
      "advisory": []
    }
  }
}
```

## Stderr logs

Human-facing status and warnings go to stderr so stdout stays reserved for the
transformed text or JSON envelope. `--quiet` suppresses those stderr logs.

### Star reminder

After the 3rd and the 20th successful run, the CLI prints one stderr line
asking for a GitHub star. It never appears again after that. It prints only when
stderr is a terminal, so pipes, hooks, CI, and `--quiet` runs never see it, and
those runs are not counted. It makes no network call and does not check whether
you starred; the only state is a run counter in `~/.patina/star-nudge.json`
(`PATINA_STATE_DIR` moves it). Exit codes and stdout are unaffected.

Turn it off with `star-nudge: false` in `.patina.yaml` or
`PATINA_NO_STAR_NUDGE=1`.

The skill helper (`bin/patina-skill.js`) shares the counter but counts verified
rewrites only. It never prints; it sets `"notice": "star"` in its JSON summary
and the host agent adds the line after the result, outside the accepted output.
`notice` is `null` on every other run.

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
| `agy-cli` | minimal | 1 | 0 |

Local CLIs are agent runtimes, not stateless completion APIs. For large rewrite
batches, prefer an OpenAI-compatible HTTP provider. Override the guardrails only
when you have measured the backend:

```bash
patina --batch --backend openai-http --max-concurrency 4 --max-retries 2 docs/*.md
patina --batch --backend kimi-cli --max-concurrency 1 --max-retries 0 docs/*.md
```

Circuit breakers stop batch mode after repeated failure instead of burning quota:

```bash
patina --batch --max-failures 5 --max-failure-rate 0.25 docs/*.md
patina --batch --timeout-ms 600000 docs/*.md
```

`--max-failure-rate` accepts either a ratio (`0.25`) or a percent (`25`). By
default, batch mode stops after a small failure budget, after a 25% failure rate
once enough files have run, or after repeated retryable storms such as HTTP 429,
timeouts, empty local-CLI responses, or repeated temporary-failure exits
(exit code 75). Storm stopping is on by default; pass
`--no-stop-on-retryable-storm` to keep the batch running through storms.

MDX/frontmatter note: patina does not parse MDX or rewrite YAML frontmatter
schemas. For `.mdx` batches, run your site's MDX/build validator after patina
and keep project-specific guards for frontmatter quoting, trailing model footers,
and JSX hazards such as malformed `<digit` fragments.

See [EXIT-CODES.md](EXIT-CODES.md) for the full process contract.
