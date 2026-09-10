# patina architecture: the two engine lanes

patina produces every output through one of two methods, and binds them together
with a single rule. This document is the **canonical contract** for which method
governs each surface, which module belongs to which lane, and the invariants each
lane must uphold.

The v7 boundary also defines three independent rewrite axes: Document Type owns
document policy, Persona v2 optionally owns reusable voice, and Register owns
casual/professional delivery. None is inferred from another.
This is field ownership, not three competing full-text styles. Meaning and
safety are the outer invariant; Document Type resolves structure and domain
constraints, Persona resolves idiolect and rhythm, and Register resolves only
casual/professional markers. No active axis supplies a missing axis.


See also: [`CONTRIBUTING.md`](../CONTRIBUTING.md) (the determinism rule —
"Adding a Deterministic Detection Signal"), [`docs/HARNESS.md`](HARNESS.md) (the
measurement/quality **tooling** map — a different axis),
[`docs/GLOSSARY.md`](GLOSSARY.md).

---

## The two methods

### Method D — deterministic (measure with code, never call a model)

Computes its answer from the text with code only: no LLM call, no network, no API
key, fully reproducible. Lives in `src/features/*` and the deterministic
backstops. This is patina's **trust / auditability substrate**, the public,
offline, no-key surface, and the ground truth that the benchmark/CI layer pins.

### Method P — LLM transformation (transform with a model, prove meaning survived)

Produces its answer by prompting an LLM — to rewrite, or to narrate a score /
audit / diff. Document Type, Persona, and Register may independently shape a
rewrite. Method P may change wording but MUST NOT change the underlying claim,
numbers, polarity, or causation.

### The binding rule

> **No Method-P output ships without a Method-D anchor.**

Every LLM-backed surface is reconciled, backstopped, or gated by a deterministic
computation. patina is auditable not because some modes avoid the model, but
because the deterministic substrate (Method D) underwrites everything the model
(Method P) emits.

This is the key correction to the intuitive "audit modes are deterministic,
rewrite is the LLM one" picture: **every CLI mode calls the backend**
(`invokeBackendChain` in `src/cli/run.js`). What differs is the *strength of the
Method-D anchor* under each surface — see [Known seams](#known-seams).

---

## Lane invariants (the contract)

**Lane A (Method D) MUST:**
- stay LLM-free, deterministic, network-free, and key-free. This is the hard rule
  (CONTRIBUTING.md) on `src/features/*` and the deterministic scoring layer.
- only *measure*; it never emits a meaning-changed rewrite.
- not import or depend on Lane B. The dependency direction **A → B is forbidden**.

**Lane B (Method P) MUST:**
- anchor every shipped output to a Method-D computation (reconcile, backstop, or
  gate).
- enforce global meaning preservation independently of every rewrite axis.
  `--verify` owns the configurable MPS/fidelity floors and retry path; no
  Document Type, Persona, or Register may weaken them.
- treat Persona v2 as **voice composition only**. It may shape vocabulary,
  explanation habits, rhythm, and other voice targets, but never document
  policy, register, claims, safety thresholds, or worldview.
- keep its own deterministic assets (`src/features/persona-match.js`,
  `src/verify.js#deterministicMeaningGuard`) auditable and LLM-free even though
  they serve Lane B.
- **never add an LLM call into `src/features/*`** — the determinism rule binds the
  whole analysis layer, not just the modules that happen to live in Lane A today.

**Cross-lane:**
- Lane B MAY consume Lane A measurements. **B → A is allowed and expected**:
  `persona-match` and `buildDocumentSignals` reuse `analyzeText()`.
- The reverse (A → B) is forbidden.

---

## Surface → method → Method-D anchor

Backend-backed modes use Method P; the rightmost column is the Method-D anchor.

| Surface | mode | LLM call? | Method-D anchor |
|---|---|---|---|
| default | `rewrite` | yes | `deterministicMeaningGuard`; optional Persona match/churn advisory; `verify.js` MPS/fidelity + retry only with `--verify` |
| `--audit` | `audit` | yes | `buildDeterministicAuditBackstop` |
| `--score` | `score` | yes | `withDeterministicScore`; optional `--exit-on` gate |
| `--score --offline` | `score` | **no** | deterministic signal score |
| `--diff` | `diff` | yes | deterministic pattern/detection report |
| `--preview [--serve]` | preview job | yes | deterministic prose extraction + word-diff rendering |
| `--xliff [--dry-run]` | xliff | yes (none with `--dry-run`) | deterministic segment parse/scan/select in `src/cli/xliff.js`; rewrites reuse the rewrite lane |
| `patina pack list/install` | — | **no** | licensed pack delivery (`src/commands/pack.js` ↔ `src/pack-handler.js`), entitlement checked server-side |
| `patina-score` (bin) | — | **no** | hot-paragraph ratio over `analyzeText()` |
| playground / hosted rewrite | — | yes | shared server-side prompt, analysis, and scoring assets |

Notes: Persona is opt-in for rewrite/preview in ko/en/zh/ja. Omission preserves
the source voice. Persona match and churn are advisory; meaning and number
checks remain global. `--serve` is a `--preview` transport option.

---

## Module → lane

### Lane A — deterministic substrate (LLM-free)

- `src/features/index.js` — `analyzeText()`, the engine
- `src/features/stylometry.js`, `translationese.js`, `discourse-tells.js`,
  `markup-leakage.js`, `segment.js`, `structural-features.js`,
  `structural-model-loader.js`, `lexicon.js`, `lexicon-core.js`, `catalog/*`
- `src/output.js#buildDeterministicAuditBackstop`,
  `src/cli/run.js#withDeterministicScore` — audit/score backstops
- `src/cli/score-gate.js` — `--exit-on` score gate
- Pure Method-D *surfaces* over this engine: `patina-score`
  (`scripts/prose-score.mjs`, the CI score gate) and the benchmark / HARNESS
  layer call `analyzeText()` with no model. The browser playground no longer
  ships an offline audit mirror — it was dropped when the playground became
  rewrite-first.

### Lane A asset consumed by Lane B (deterministic, cross-lane)

- `src/features/persona-match.js` — LLM-free persona-match scorer. It lives in
  `features/` **on purpose**, to inherit the determinism guarantee, but it is
  authored for Lane B's optional Persona quality report.

### Lane B — LLM rewrite and optional Persona voice (LLM-backed)

- `src/personas/{schema,loader,compose,gates}.js` — Persona v2 voice schema,
  loader, localized prompt directive, and advisory voice-quality evaluation;
  `personas/{ko,en,zh,ja}/*.md` — built-in Personas;
  `custom/personas/{lang}/*.md` — user-authored Personas
- `src/commands/persona.js` — `patina persona new|list|show|edit|rm`
- `src/prompt-builder.js` — rewrite/score/audit/diff prompt construction
- `src/scoring.js` — LLM MPS/fidelity scoring (excluded from the deterministic
  benchmark/gate layer)
- `src/verify.js` — post-rewrite meaning verification + one strict retry
  (`deterministicMeaningGuard` is its LLM-free part)
- `src/web-rewrite.js`, `web-rewrite-contract.js`, `web-rewrite-stream.js`,
  `rewrite-handler.js`, `streaming-api.js` — web / hosted rewrite path
- `src/web-config.js`, `web-observability.js`, `rate-limit.js`, `security.js` —
  web rewrite serving infrastructure
- `src/web-prompt-budget.js`, `web-rewrite-receipt.js`, `pro-monitor.js`,
  `funnel-analytics.js` — hosted request-shaped prompt budgets, downloadable
  audit receipts, aggregate-only Pro health monitor, and privacy-safe funnel
  events (no request content retained)
- `src/entitlement.js`, `entitlement-polar.js`, `polar-webhook.js`,
  `pack-handler.js` — server-only Pro entitlement (Polar license keys,
  Standard-Webhooks verification) and licensed pack delivery
- `src/preview/*`, `preview.js`, `browser-diff.js` — `--preview` page presentation
  over rewrite output (deterministic rendering; optional LLM diff narration)

### Shared infrastructure (lane-neutral)

- `src/cli.js`, `cli/args.js`, `cli/run.js` (dispatcher), `cli/input.js`, `cli/batch.js`, `cli/xliff.js`
- `src/commands/pack.js` — client half of `patina pack`
- `src/config.js`, `errors.js`, `logger.js`, `loader.js`, `model-defaults.js`, `output.js`
- `src/api.js`, `providers.js`, `backends/*`, `anthropic-native.js` (opt-in native
  Anthropic Messages adapter) — LLM transport (used only by Lane B, kept as
  shared transport)
- `src/auth.js`, `commands/auth.js`, `commands/doctor.js`
- `src/ocr.js` — image → text input extraction
- `scoring`, `verification`, and `personas.thresholds` are separate
  configuration namespaces. Persona thresholds cover advisory voice quality;
  verification owns MPS/fidelity floors.

## Responsibility and lifecycle map

The repository keeps its current directories; the following map assigns
responsibility without turning every internal module into a supported API.

| Lifecycle stage | Primary owner | Boundary that must remain true |
|---|---|---|
| CLI or HTTP entry | `bin/patina.js`, `src/cli.js`, `api/*.js` | Parse and validate user input before any provider, filesystem, or secret access. |
| Input and settings | `src/cli/input.js`, `src/loader.js`, `src/config.js`, `src/web-config.js` | Resolve documented defaults and user assets; reject malformed or retired keys instead of silently guessing. |
| Deterministic analysis | `src/features/**`, `src/prose-core.js`, deterministic scoring helpers | Remain reproducible, network-free, key-free, and independent of Lane B. |
| Prompt and model execution | `src/prompt-builder.js`, `src/backends/**`, `src/api.js`, `src/streaming-api.js` | Keep credentials, provider calls, retries, and timeouts outside `src/features/**`. |
| Meaning and quality verification | `src/verify.js`, `src/verification-schema.js`, deterministic meaning guards | Verify the exact candidate that will be emitted; never let Persona, Register, or Document Type lower global safety floors. |
| Output and transport | `src/output.js`, `src/web-rewrite-contract.js`, `src/web-rewrite-stream.js` | Keep stdout/API terminal states machine-readable and distinguish failure, cancellation, and below-floor results. |
| Browser presentation | `playground/**` | Use only browser-safe shared modules and the documented HTTP contract; no server secrets or Node-only runtime imports. |
| Research and maintenance | `scripts/research/**`, `tests/quality/**`, `artifacts/**` | Stay outside product runtime and public consumer contracts; historical evidence is not a runtime default. |

The normal request lifecycle is **entry → input/settings → deterministic
analysis → (optional) model transform → verification → formatting/transport**.
The browser follows the same server-side lifecycle over the HTTP contract; it
does not duplicate the analyzer or carry provider credentials. Research scripts
may call product modules for measurement, but product runtime must not call
research modules.

### Import support boundary

The supported Node consumer is the installed `patina`/`patina-cli` command
(`bin/patina.js`) and the commands and flags documented in
[`docs/CLI.md`](CLI.md). HTTP consumers use the routes and schemas in
[`docs/HTTP-API.md`](HTTP-API.md). `src/**` is an implementation namespace:
deep-importing an internal file is not a compatibility promise unless a
document explicitly names that module and contract. The same rule applies to
`scripts/**`, `tests/**`, and generated playground assets.

The public configuration surface is `.patina.yaml` / `--config` with the
documented `document-type`, `persona`, `register`, verification, and list
fields. `--config-snapshot` is an internal skill-to-CLI transport and is not a
replacement public configuration format. The removed v6 keys `profile`, `tone`,
and `formality` fail with an input error (exit code 2); they are never aliases or
silent fallbacks. The deterministic `patina inspect` consumer contract emits
JSON with `schemaVersion`, `language`, `sourceHash`, `deterministicOnly`,
`offsetEncoding`, `available`, `score`, and `diagnostics`; consumers must check
the exit code and validate the shape rather than treating a non-empty string as
proof.

### Machine-checked dependency boundaries

`node scripts/check-architecture.mjs` builds an import graph with the
repository's ESLint `espree` parser (the checked environment uses espree
9.6.1). It reads static imports, re-exports, and string-literal dynamic
imports from `src/`, `api/`, `bin/`, and `playground/`, plus the explicitly
declared `bin` entries in the root and `packages/patina-humanizer` manifests.
The published roots therefore include `bin/patina.js`,
`scripts/precommit-score.mjs` (`patina-score`), and
`packages/patina-humanizer/bin/patina-humanizer.js`; reachable non-research
helpers are parsed without scanning all research scripts. A non-literal
dynamic import, an unresolved local import, a parse/read failure, or a
declared published bin omitted from the graph is reported as an incomplete
graph rather than a pass. `--json` is intended for CI evidence and `--root DIR`
is a fixture seam.

The checker enforces only three reachability rules:

1. `src/features/**` cannot reach model/network transports or network and
   subprocess built-ins, directly or transitively.
2. `playground/**` cannot reach server-secret modules, API handlers, or Node
   built-ins.
3. `src/**`, `api/**`, `bin/**`, and every declared published package bin
   cannot reach packaged research modules.

Deterministic shared modules are classified rather than blanket-banned:
`src/edit-controls.js`, `src/errors.js`, `src/logger.js`,
`src/model-defaults.js`, `src/web-rewrite-contract.js`,
`src/personas/gates.js`, and `scripts/prose-score.mjs` are the reviewed
examples. The current audited exceptions are the lexicon and structural model
loaders' local `fs`/`path`/`os` reads, browser use of the shared
`web-rewrite-contract`/`edit-controls` utilities, and inspection's reuse of
the deterministic prose scorer. Each exception is exact-path and reason
annotated in the checker; it is not a broad baseline whitelist.

The checker's coverage is intentionally bounded: it does not evaluate runtime
`eval`, generated code, non-literal module specifiers, package-internal
resolution, or research modules' own loaders. Unresolved cases remain
diagnostics and therefore cannot be reported as a complete passing graph.

Type checking follows the same incremental boundary. The browser regression
module [`tests/browser/playground.test.js`](../tests/browser/playground.test.js)
is the current checked-JavaScript pilot: it uses `// @ts-check` and focused
Playwright JSDoc types so the existing root `tsconfig.json` can catch a real
async contract error (for example, a missing `await`). This is evidence for
that test module only, not a claim that all JavaScript is type-checked and not
a reason to add a second project-wide TypeScript configuration.

### Packaged research comparator (unsupported)

- `scripts/iterative-rewrite-baseline.mjs` — `iterative-baseline`, a packaged
  research comparator outside the product API, CLI help, and configuration surface. The package has no `exports` map, so the module remains deep-importable but unsupported.
---

## Seams: resolved and remaining

### Resolved axis ownership

1. **Document Type owns document policy.** `document-types/*.md` supplies genre,
   purpose, structural conventions, and `pattern-overrides`; it contributes no
   voice or Register instruction.
2. **Persona v2 owns reusable voice only.** Persona is optional in every
   supported language. Its schema rejects Document Type, Register, pattern
   policy, verification, meaning floors, and rewrite-depth fields.
3. **Register owns delivery only.** `--register` and `register:` accept exactly
   `casual` or `professional`. Omission preserves the source register.
4. **Safety is global.** The deterministic meaning guard applies regardless of
   axis selection; `--verify` owns MPS/fidelity floors and one conservative
   retry. Persona match and surface churn remain advisory.
5. **The v7 cutover is explicit.** `profile`, `tone`, and `formality` inputs
   fail with migration errors rather than aliases or silent fallback.

### Remaining

- **`persona new` / `persona edit` LLM drafts are non-deterministic.** Authoring uses a one-time
  model call; the saved persona file is deterministic, but two authoring runs on
  the same input can differ. Validation (`validatePersona`) is the safety net.

---

## Provenance

- Two-mode coexistence (LLM rewrite + offline deterministic audit):
  deep-interview playground spec, R6.
- Persona harness safety invariants: deep-interview persona spec + ralplan
  consensus (recorded in the `src/personas/schema.js` header).
- Hosted open-core enhancement (baseline open + enhanced assets server-side):
  deep-interview open-core spec.
