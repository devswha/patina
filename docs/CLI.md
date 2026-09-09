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

`0` success · `1` runtime/backend · `2` input/usage · `3` score gate exceeded · `4` meaning-safety exit (`--verify` floor miss or dropped number; rewrite still printed) · `130` interrupted. Full definitions and merge rules: [EXIT-CODES.md](EXIT-CODES.md).

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
- `patina doctor --json` emits setup diagnostics for CI without making an LLM call.


## Meaning verification: `--verify`

`--verify` folds a meaning-preservation check into the normal rewrite. After the rewrite it scores MPS and fidelity; if either is below the floor (`verification.{mps-floor,fidelity-floor}`, default 70) it runs **one** conservative retry that re-rewrites from the original with a strict meaning-preservation directive. If the retry still misses, patina emits the closest (highest-fidelity) candidate and warns on stderr — fail-closed but non-destructive, so stdout always carries usable text.

```bash
patina --verify draft.md
patina --verify --lang ko --backend codex-cli draft.md
```

- It is a rewrite modifier, not a separate mode: combining it with `--score`, `--audit`, `--diff`, or `--preview` is an input error (those do not rewrite).
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
`floor-not-met`, `retry-error`, `dropped-numbers`, or `output-changed`.
If cleanup changes the graded text, the CLI sets `verified:false`, reports
`output-changed`, and exits 4. The numeric guard sets `verified:false` and
`reason:"dropped-numbers"` even if the scorers passed. The draft appears only in
the existing `output` field. Plain output retains its existing body;
JSON without `--verify` has no `verification` field. Automation must check exit
0, `verification.verified === true`, finite scores meeting its required
floors, and `verification.outputHash` matching the exact `output` bytes.
A nonempty `output` or the envelope's legacy `mps` field is not proof.

The Aside adapter requires matching output hashes, valid verification metadata,
and at least 70 for both scores. It retains stricter configured floors. Its optional programmatic
`overrides` object uses the saved settings field names, validates the merged
selection, and applies it to one rewrite. `settings` and `settingsHash` identify
the saved preferences; `effectiveOptions` records the merged invocation and
resolved language. Overrides do not save preferences or accept credentials,
base URLs, or verification thresholds.

The Node CLI keeps Persona quality and verification separate. `--verify` uses
`verification.{mps-floor,fidelity-floor}`; `personas.thresholds` contains only
advisory voice-match and surface-churn thresholds.

### Deterministic meaning guard (always on, no LLM)

Every rewrite (with or without `--verify`) runs a cheap deterministic guard that warns on stderr when numbers present in the source go missing from the rewrite. It never blocks output and makes no model calls (length is intentionally not checked — a humanizer legitimately changes length).

## Three independent rewrite axes

These options compose but never imply one another:

| Axis | Input | Runtime asset | Omission |
|---|---|---|---|
| Document Type | `--document-type <name>` / `document-type:` | `document-types/<name>.md` or `custom/document-types/<name>.md` | `default` document policy |
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
| `--preview --persona p` | allowed |
| `--persona p --register casual|professional` | allowed; independent axes |
| `--persona p --document-type blog` | allowed; independent axes |
| `--persona p --jargon explain|remove` | allowed in rewrite/preview |

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

## Transformations beyond cleanup: `--jargon`

By default patina is a conservative humanizer: it removes AI tells without changing a sentence's claim or framing. `--jargon` is an explicit opt-in for adjusting terminology for a different audience. It applies to the default rewrite and `--preview` only; combining it with `--score`, `--audit`, or `--diff` is an input error (those modes do not rewrite). A voice or delivery override uses `--persona` or `--register`; neither changes rewrite depth.

```bash
patina --jargon remove draft.md                        # de-jargonized rewrite
patina --preview --jargon remove https://example.com/  # de-jargonized in-place preview
patina --jargon explain --register casual draft.md     # gloss terms, casual register
```

- `--jargon keep` (default) — technical terms untouched.
- `--jargon explain` — keep terms, add a brief plain-language gloss at first use.
- `--jargon remove` — replace developer/technical jargon with everyday language; product names and proper nouns stay.

### Variant comparison in the preview

With `--preview`, `--jargon` and `--register` accept comma-separated lists;
every combination becomes a variant — one rewrite call each, capped at 4 — and
the preview bar gains a second toggle group:

```bash
patina --preview --jargon keep,remove <url>
patina --preview --jargon remove --register casual,professional <url>
patina --preview --register casual,professional <url>
```

- The bar groups variants by jargon policy, with a secondary Register chip row when needed.
- The score chip shows each variant's deterministic score (`score 23 → cleanup 5 · remove 8`).
- A comma-listed `--register` joins the cross product. Document Type and Persona stay fixed.
- A block counts as changed when **any** variant changes it; a variant that left a block alone shows the original text under that button.
- stdout carries the first variant's prose (pipe-safe); the explanation call is skipped in compare mode to keep the call budget at one per variant.
- Compare mode needs a page snapshot (URL or `.html`) and is incompatible with `--ocr`; comma lists without `--preview` are an input error.

### Word-level diff view

The view toggle has four states: **rewritten** (default), **original**, **both**, and **diff**. The diff view renders each changed block as one merged stream — common words plain, removed words struck red, added words highlighted green — so the exact edit is visible instead of a whole-sentence strikethrough. It is computed deterministically when the page is built (LCS over whitespace tokens, matrix-capped with a whole-text del/ins fallback for huge blocks) and works per variant in compare mode.

Facts, numbers, names, and causal claims must never be invented, dropped, or reversed. Transform options change terminology or delivery, not truth.

## Stderr logs

Human-facing status and warnings go to stderr so stdout stays reserved for the
transformed text or JSON envelope. `--quiet` suppresses those stderr logs.

## In-place preview: `--preview`

`--preview` rewrites prose and renders the rewrites **in place** — each rewritten block highlighted and numbered, a floating bar with the change count, deterministic before/after score, jump chips, a three-state view toggle (rewritten / original / both), and a "patina notes" panel with the Pattern/Removed/Added/Why explanation.

It accepts one input: an http(s) URL or a `.html`/`.htm` file (snapshot pipeline, same as a fetched page). Other extensions are rejected up front — rewrite a markdown/text draft with `patina <file>` or inspect it with `patina --diff <file>`.

```bash
patina --preview https://example.com/article           # live page, snapshot overlay
patina --preview export.html                           # local HTML, snapshot overlay
patina --preview --serve https://example.com/article   # headless: serve at a token URL
```

URL contract:
- Rewrites plain-text prose blocks: `p`, headings, `li`, `blockquote`, …, plus `div`/`section`/`article` containers that directly hold copy (modern pages put most body text in styled divs). The scan is leaf-first — a container with nested block markup is rejected and the scan descends into it, so prose inside list items, quotes, and wrapper divs is found; HTML5 optional end tags (`<li>`/`<p>` without a close) and React SSR's empty-comment text separators (`<!-- -->`) are handled. Navigation chrome is never rewritten: `nav`/`aside`/`button` content, containers with a navigation `role` (`navigation`, `complementary`, `menu`, `menubar`, `toolbar`, `tablist`), and containers whose id/class carries a sidebar/TOC/breadcrumb token (covers app-shell layouts like Fumadocs' `#nd-sidebar`/`#nd-toc`). Blocks carrying inline `code`/`kbd`/`var` are also left untouched — their content is a verbatim token (package name, command, key cap) a rewrite could corrupt, and the in-place swap would flatten the markup to literal backtick text. Prices, tables, and other mixed-markup blocks stay out as before. Single-link blocks are treated as navigation unless long enough to be a whole-card teaser. One rewrite call plus one best-effort explanation call.
- The snapshot is inert: scripts are removed (hydration would revert the swapped text), inline event handlers and `javascript:` URLs (including entity-encoded and `/`-separated forms) are neutralized, and a `<base href>` keeps the page's own CSS and images loading. Sanitization is tag-aware (it walks real tag tokens, skipping quoted attribute values), so an unclosed `<script>` or a handler hidden behind a `>` inside an attribute can't survive. The generated page also carries a restrictive CSP (`script-src`/`frame-src`/`object-src 'none'`, passive `img`/`style`/`font` allowed) so any active vector the stripper missed — a `data:`/`javascript:` `<iframe>`, a plugin — stays inert without breaking image/CSS fidelity. React 18 streaming pages are resolved statically (`$RC`/`$RS` swaps applied at snapshot time) so Suspense content renders instead of loading spinners. `<iframe srcdoc="…">` detail content (sites embed long below-the-fold pages this way) is decoded and inlined so its copy and images are extracted and rewritten too; the inlined block is a CSS container and the detail's `vw`/width-`@media` styles are rewritten to container units, so its typography and breakpoints render exactly as they did inside the iframe.
- **Snapshot asset freezing**: same-origin stylesheets are downloaded at snapshot time and inlined as `<style>` blocks (relative `url()` references absolutized against each stylesheet's own URL), and same-origin fonts they reference are embedded as `data:` URIs. This keeps the saved page rendering identically even when the site refuses cross-site asset loads via Fetch Metadata (e.g. Vercel returns 404 to `Sec-Fetch-Site: cross-site` requests — which a saved snapshot always sends). Cross-origin sheets keep their `<link>`; fetches are SSRF-guarded and capped; any failure falls back to the original `<link>`.
- `--ocr` image URLs fetched from page **content** are SSRF-guarded: the host is resolved and a private/loopback/link-local/metadata result is refused unless it matches the previewed page's own host (so a localhost dev preview still loads its own assets, but an arbitrary public page can't make patina probe `169.254.169.254` or internal services). The check covers IPv4-mapped IPv6 and is re-applied on each redirect hop. The user-typed preview URL itself is trusted and not subject to this guard.
- Works on server-rendered pages. Client-rendered SPAs ship an empty HTML shell, so there is nothing to extract — patina fails with a clear message instead of showing a blank snapshot.
- If the model returns a different paragraph count than the extracted blocks, patina falls back to LCS anchoring plus order-monotonic bigram-similarity pairing; blocks with no confident partner keep their original text (reported on stderr) instead of failing the run.

Document context:
- Rewrites run under a **document brief**: the prompt instructs the model to first identify what the document is, who is speaking to whom, the dominant register, and the recurring domain terms — and to keep that frame for every edit. All rewritten sentences are unified to the document's dominant register (register mixing is itself an AI tell).
- For Korean text the dominant register is **measured deterministically** (sentence-ending distribution: 합쇼체/해요체/-다체) and injected into the prompt as ground truth; the "patina notes" panel shows the measurement in a *document context* card.
- `--register <casual|professional>` works with `--preview` and overrides delivery; omission preserves the source register. Genre values such as `academic`, `marketing`, and `narrative` belong to `--document-type`.

File contract (local `.html`):
- A local `.html`/`.htm` file goes through the same snapshot pipeline as a fetched URL: prose blocks are extracted, rewritten, and swapped back in place. Markdown/text drafts are not accepted as preview input.
- stdout carries the rewritten prose (pipe-safe); the page path and serve URL go to stderr.

### Headless servers: `--serve`

On a machine with no display (SSH, containers), add `--serve` to serve the preview page over HTTP instead of opening a window:

```bash
patina --preview --serve https://example.com/article
patina --preview --serve export.html
```

Contract:
- Requires `--preview`; replaces the window opener (nothing is spawned).
- Binds `127.0.0.1` on a random port and serves only `GET`/`HEAD` of one unguessable token URL (`http://127.0.0.1:<port>/<token>/`); everything else is 404. Responses send `nosniff`, `no-referrer`, and `no-store` headers, and the page keeps its restrictive CSP.
- Prints the URL on stderr. From a remote shell, forward it with `ssh -L <port>:127.0.0.1:<port> <host>`; VS Code/Cursor remote terminals forward localhost URLs automatically.
- Keeps running until 10 minutes pass with no request, then stops on its own; Ctrl-C stops it immediately. The saved HTML file remains either way.

### Image text: `--ocr`

Marketing pages often carry their most AI-sounding copy inside images (card-news, banners). `--ocr` extends detection to them:

```bash
patina --preview --ocr https://example.com/product
```

- Image candidates come from `<img>` sources (including `srcset` and Next.js `/_next/image` wrappers, unwrapped to the original asset), CSS `url(…)` backgrounds scanned only inside `style="…"` attributes and `<style>` blocks (so SVG paint references like `fill="url(#grad)"` and `var(--x)` tokens aren't mistaken for images), and document-wide base64 data URIs (card-news content frequently ships as CSS `background-image` data URIs). Extension-less CDN URLs are accepted and identified by magic-byte sniffing after download — never by the server's claims. SVG is skipped; caps: 8 images per page by priority, 6MB per image, 16MB total.
- Text extraction runs through an image-capable local CLI backend — `claude-cli`, `gemini-cli`, or `codex-cli` (your selected backend when capable, otherwise the first capable one available). One extra backend call per image; images are staged into the backend's isolated temp dir, preserving the empty-cwd prompt-injection containment. `kimi-cli` and `openai-http` cannot read images. Remote pages can only reference remote (http/https) images — `file:` images are accepted only for local `.html` previews.
- Extracted text joins the same rewrite call as extra blocks. Since pixels cannot be rewritten, each changed finding appears in the auto-opened "patina notes" panel as a card embedding **the exact image patina OCR'd** (a thumbnail) next to the extracted text and the suggested rewrite — so findings on carousel slides, lazy-loaded images, or CSS background images are visible regardless of how the snapshot froze. A plain `<img>` in the DOM additionally gets a dashed-bronze `I`-badge in place.
- stdout never includes OCR text (pipe-safe); the flagged-image count is reported on stderr.


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

## XLIFF localization humanize: `--xliff`

`--xliff <file.xliff>` humanizes the translated `<target>` segments of an XLIFF 1.2 file (Crowdin/CAT exports) through the normal rewrite pipeline, then writes the file back **byte-for-byte identical except for the humanizable target text**. It is a humanizer, not a translator: it never changes the claim, numbers, polarity, or placeholders (`%s`, `%1$d`, …), and every segment must clear the same MPS/fidelity floors as `--verify` (default 70) or the original target bytes are kept.

```bash
patina --xliff app.xliff                 # -> app.humanized.xliff (never clobbers the original)
patina --xliff app.xliff --dry-run        # plan only: 0 LLM calls, 0 writes
patina --xliff app.xliff --outdir out/    # write into a directory
patina --xliff app.xliff --in-place       # overwrite the original (explicit + atomic)
patina --batch --xliff locales/*.xliff    # multiple files
```

What it does, in order: detect and normalize the file's `target-language` (`ko-KR`→`ko`, `en-US`→`en`, `zh-CN`/`zh-TW`→`zh`, `ja-JP`→`ja`; unsupported languages are rejected) → select humanizable prose targets → deduplicate identical targets → rewrite each unique target once and reuse it for every duplicate → verify each candidate and apply only the ones that pass → write atomically.

**Safety and scope:**

- **Selection is conservative.** A target is processed only when its state is allowlisted (`translated` / `final` / `signed-off` / `needs-review-translation`, or absent) and it reads as prose (≥5 space-delimited words, or ≥12 CJK characters). Locked (`translate="no"`), untranslated, short-UI, inline-markup (`<g>`/`<x>`/`<bpt>`/…), CDATA, and structurally ambiguous targets are **skipped untouched**.
- **Byte-preserving.** Only the inner target text changes; leading/trailing whitespace, XML entities, attributes, and every other byte are preserved. A no-op rewrite yields a byte-identical file.
- **Fail-closed.** Malformed input errors out before any write; a verify floor miss keeps the exact original bytes and is reported; the output is written atomically (temp + rename) so a crash never leaves a partial file, and the default output path never overwrites the input.
- **`--dry-run`** makes **0 LLM calls and 0 writes** and prints total units, selected/unique counts, dedup savings, cap status, skip reasons, the worst-case call/token estimate, and the output path.
- **`--max-segments <n>`** overrides the default cap of 50 unique segments per file (the cap is enforced after dedup, before any LLM call; over the cap fails closed in execution mode and is flagged in `--dry-run`).
- **Cross-file dedup (`--batch`).** Deduplication also spans the whole batch: a segment repeated across files (same target-language + text) is humanized once and the verified result is reused for every other file — no extra LLM calls. Reuse is scoped by target-language (identical text in a `ko` file and a `ja` file is humanized separately), errors are never cached (the next file retries), and `--dry-run` reports the cross-file reuse count.

`--xliff` accepts backend/model/provider/base-url/auth/timeout/concurrency/retry/failure-budget flags and `--suffix`/`--outdir`/`--in-place`/`--batch`/`--format`. It rejects rewrite-shaping and other-mode flags (`--audit`/`--score`/`--diff`/`--preview`/`--ocr`/`--serve`/`--exit-on`/`--persona`/`--jargon`/`--register`/`--document-type`/`--rewrite-headings`/`--verify`) with a clear input error. `--dry-run` and `--max-segments` are valid only with `--xliff`.
