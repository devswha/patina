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
- `patina doctor --json` emits setup diagnostics for CI without making an LLM call.


## Meaning verification: `--verify`

`--verify` folds a meaning-preservation check into the normal rewrite. After the rewrite it scores MPS and fidelity; if either is below the floor (`ouroboros.mps-floor` / `ouroboros.fidelity-floor`, default 70) it runs **one** conservative retry that re-rewrites from the original with a strict meaning-preservation directive. If the retry still misses, patina emits the closest (highest-fidelity) candidate and warns on stderr — fail-closed but non-destructive, so stdout always carries usable text.

```bash
patina --verify draft.md
patina --verify --lang ko --backend codex-cli draft.md
```

- It is a rewrite modifier, not a separate mode: combining it with `--score`, `--audit`, `--diff`, or `--preview` is an input error (those do not rewrite).
- The MPS/fidelity scorers run through the **selected backend**, so `--verify` works with HTTP and local CLI backends alike. It adds up to four extra model calls (two scorers, plus a retry that re-scores), so the plain rewrite stays the fast/cheap default.
- `--ouroboros` was **removed**. The iterative loop is gone; `--verify` is its meaning-floor replacement. (The multi-pass loop survives only as a research baseline in `npm run quality:rewrite-ab`.)

### Deterministic meaning guard (always on, no LLM)

Every rewrite (with or without `--verify`) runs a cheap deterministic guard that warns on stderr when numbers present in the source go missing from the rewrite. It never blocks output and makes no model calls (length is intentionally not checked — a humanizer legitimately changes length).

## Korean persona rewrite: `--persona`

`--persona <name>` selects a validated Korean persona from `personas/ko` (or a same-id custom persona) for the rewrite harness. With no explicit persona, Korean rewrite mode uses the conservative `preserve` persona: style-only, minimal change, and MPS/fidelity hard floors still enforced.

v1 KO seed library (`personas/ko`): `preserve` (default), `blog-essay`, `pragmatic-founder`, `technical-explainer`, `soft-professional`, and `natural-ko` — a cleanup persona that strips AI-tell register (wellness-translationese, flattery, hype vocabulary) into plain Korean while preserving claims.

```bash
patina --persona preserve draft.md
patina --lang ko --persona pragmatic-founder draft.md
```

Contract:

| Combination | v1 behavior | Reason |
|---|---|---|
| `patina file` | allowed; equivalent to `persona=preserve` in Korean rewrite | safe default |
| `--persona p file` | allowed | core v1 surface |
| `--lang ko --persona p` | allowed | KO library only |
| `--lang en|zh|ja --persona p` | input error | no non-KO persona library |
| `--score/--audit/--diff --persona p` | input error | persona v1 is rewrite-only |
| `--preview --persona p` | input error | preview migration is later |
| `--persona p --jargon x,y`, `--tone a,b` | input error | comma-list variants are preview-only |
| `--persona p --tone casual` | allowed as compatibility hint | persona remains outer contract |
| `--persona p --profile blog` | allowed as compatibility hint | legacy profile remains non-authoritative |
| `--persona p --jargon explain|remove` | input error | terminology rewrite is not gated in v1 |

Persona files are frontmatter-only at runtime. Markdown bodies are documentation and never enter prompts. The `worldview` block is reserved but inactive in v1. Even `depth: content` personas may adjust emphasis and coverage only; they cannot invent claims or make MPS/fidelity advisory.

For `--format json`, rewrite output includes a `persona` field when a persona gate ran:

```json
{
  "persona": {
    "id": "preserve",
    "depth": "style-only",
    "thresholds_source": "placeholder",
    "match": 82.4,
    "mps": 91,
    "fidelity": 88,
    "over_edit_churn": 0.18,
    "gate_result": { "pass": true, "hardFailures": [] }
  }
}
```

## Transformations beyond cleanup: `--jargon`

By default patina is a conservative humanizer: it removes AI tells without changing a sentence's claim or framing. `--jargon` is an explicit opt-in for adjusting terminology for a different audience. It applies to the default rewrite and `--preview` only; combining it with `--score`, `--audit`, or `--diff` is an input error (those modes do not rewrite). A full voice/register change is `--persona` / `--tone`, not a rewrite depth.

```bash
patina --jargon remove draft.md                        # de-jargonized rewrite
patina --preview --jargon remove https://example.com/  # de-jargonized in-place preview
patina --jargon explain --tone casual draft.md         # gloss terms, casual register
```

- `--jargon keep` (default) — technical terms untouched.
- `--jargon explain` — keep terms, add a brief plain-language gloss at first use.
- `--jargon remove` — replace developer/technical jargon with everyday language; product names and proper nouns stay.

### Variant comparison in the preview

With `--preview`, `--jargon` **and `--tone`** accept comma-separated lists; every combination becomes a **variant** — one rewrite call each, capped at 4 — and the preview bar gains a second toggle group to switch between them in place:

```bash
patina --preview --jargon keep,remove <url>                  # cleanup / de-jargoned side by side
patina --preview --jargon remove --tone casual,professional <url>  # same policy, two voices
patina --preview --tone casual,professional <url>           # register comparison
```

- The bar groups variants two-level: one primary button per jargon policy (cleanup/explain/remove) and, when a policy carries multiple options (tone), a secondary chip row that appears only while that policy is selected — click **remove**, then pick **casual** or **professional**. Each policy remembers its own option selection. The switch is CSS-only (chained radio groups), so the snapshot stays scriptless and the page CSP keeps `script-src 'none'`.
- The score chip shows each variant's deterministic score (`score 23 → cleanup 5 · remove 8`).
- A comma-listed `--tone` joins the cross product: each variant resolves its own register (genre profile is fixed by `--profile`), exactly as a single run with that `--tone` would. Labels carry the tone when it varies (`remove·casual`).
- A block counts as changed when **any** variant changes it; a variant that left a block alone shows the original text under that button.
- stdout carries the first variant's prose (pipe-safe); the explanation call is skipped in compare mode to keep the call budget at one per variant.
- Compare mode needs a page snapshot (URL or `.html`) and is incompatible with `--ocr`; comma lists without `--preview` are an input error.

### Word-level diff view

The view toggle has four states: **rewritten** (default), **original**, **both**, and **diff**. The diff view renders each changed block as one merged stream — common words plain, removed words struck red, added words highlighted green — so the exact edit is visible instead of a whole-sentence strikethrough. It is computed deterministically when the page is built (LCS over whitespace tokens, matrix-capped with a whole-text del/ins fallback for huge blocks) and works per variant in compare mode.

In every depth, facts, numbers, names, and causal claims must never be invented, dropped, or reversed — the directive relaxes style and structure, not truth.

## Stderr logs

Human-facing status, warnings, and progress indicators go to stderr so stdout
stays reserved for the transformed text or JSON envelope.

- `--quiet` suppresses stderr logs, including Ouroboros progress.
- Ouroboros reports per-iteration score movement and latency.


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
- `--tone <casual|professional|auto>` works with `--preview` and overrides the target register; the register-unification rule still applies. (academic/marketing/narrative/instructional are genres — use `--profile`.)

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
