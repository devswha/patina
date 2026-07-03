# patina architecture: the two engine lanes

patina produces every output through one of two methods, and binds them together
with a single rule. This document is the **canonical contract** for which method
governs each surface, which module belongs to which lane, and the invariants each
lane must uphold.

It is the stable boundary the persona hardening line was built on — the enforcing
safety gate, multilingual personas, the register/profile precedence, and
custom-voice authoring ([ROADMAP](ROADMAP.md) Product Phase 4, now shipped) — and
that hosted enhancement and further persona-gate work continue to build on.

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

### Method P — persona / LLM (transform with a model, prove meaning survived)

Produces its answer by prompting an LLM — to rewrite, or to narrate a score /
audit / diff. A persona optionally shapes the *voice* of a rewrite. Method P may
change wording but MUST NOT change the underlying claim, numbers, polarity, or
causation, and MUST prove the meaning survived.

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
- enforce the meaning-preservation floors (MPS ≥ 70, fidelity ≥ 70) and never
  weaken them. A persona may *raise* a floor, never lower it
  (`src/personas/schema.js`).
- treat a persona as **voice composition only**: it may reweight emphasis /
  coverage and style, but never inject claims, numbers, examples,
  metaphors-as-facts, or worldview (`blocks.worldview` is schema-reserved and
  inactive in v1).
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

Every CLI mode prompts the backend; the rightmost column is what keeps it
auditable.

| Surface | mode | LLM call? | Method-D anchor |
|---|---|---|---|
| default | `rewrite` | yes | `deterministicMeaningGuard` (dropped-numbers, always); persona **safety gate** MPS/fidelity/churn→numbers (if `--persona`); `verify.js` MPS/fidelity + retry (if `--verify`) |
| `--audit` | `audit` | yes | `buildDeterministicAuditBackstop` (deterministic detections appended) |
| `--score` | `score` | yes | `withDeterministicScore` reconciles the LLM overall with deterministic signals; `--exit-on` score gate |
| `--diff` | `diff` | yes | deterministic pattern/detection report |
| `--preview [--serve]` | preview job | yes | deterministic prose extraction + word-diff rendering over the rewrite |
| `patina-score` (bin) | — | **no** | pure Method D: hot-paragraph ratio over `analyzeText()` — the deterministic CI gate (`scripts/prose-score.mjs`) |
| playground / hosted **rewrite** | — | yes | rewrite-first (no offline browser audit surface); reuses prompt + scoring assets server-side |

Notes: `--persona` runs on **rewrite, non-preview**, in any supported language
(ko/en/zh/ja); ko applies the `preserve` default implicitly, en/zh/ja are opt-in
(Lane B only; `src/cli/run.js#resolvePersonaForRun`). The safety gate enforces
MPS/fidelity/dropped-numbers and reuses `--verify`'s real scores when present;
churn and persona-match are advisory. `--serve` is a `--preview` transport
option, not a standalone mode.

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
  authored for Lane B's persona gate. This is the one piece of Lane B's
  verification that is already deterministic.

### Lane B — persona / LLM rewrite (LLM-backed)

- `src/personas/{schema,loader,compose,gates}.js` — persona config SSOT, loader,
  localized prompt directive, gate evaluation (enforcing safety vs advisory);
  `personas/{ko,en,zh,ja}/*.md` — built-in personas (each language ships at least
  `preserve`); `custom/personas/{lang}/*.md` — user-authored personas
- `src/commands/persona.js` — `patina persona new|list` custom voice authoring
  (one-time LLM draft + deterministic anchors → validated persona file)
- `src/prompt-builder.js` — rewrite/score/audit/diff prompt construction
- `src/scoring.js` — LLM MPS/fidelity scoring (excluded from the deterministic
  benchmark/gate layer)
- `src/verify.js` — post-rewrite meaning verification + one strict retry
  (`deterministicMeaningGuard` is its LLM-free part)
- `src/ouroboros.js` — iterative multi-pass rewrite with regression rollback
- `src/web-rewrite.js`, `web-rewrite-contract.js`, `web-rewrite-stream.js`,
  `rewrite-handler.js`, `streaming-api.js` — web / hosted rewrite path
- `src/web-config.js`, `web-observability.js`, `rate-limit.js`, `security.js` —
  web rewrite serving infrastructure
- `src/preview/*`, `preview.js`, `browser-diff.js` — `--preview` page presentation
  over rewrite output (deterministic rendering; optional LLM diff narration)

### Shared infrastructure (lane-neutral)

- `src/cli.js`, `cli/args.js`, `cli/run.js` (dispatcher), `cli/input.js`, `cli/batch.js`
- `src/config.js`, `errors.js`, `logger.js`, `loader.js`, `model-defaults.js`, `output.js`
- `src/api.js`, `providers.js`, `backends/*` — LLM transport (used only by Lane B,
  kept as shared transport)
- `src/auth.js`, `commands/auth.js`, `commands/doctor.js`
- `src/ocr.js` — image → text input extraction

---

## Seams: resolved and remaining

Boundaries where the lanes used to bleed. The persona hardening line closed most
of them; what remains is named here as the surface for later work.

### Resolved

1. **The persona gate now enforces safety.** The gate is split into an *enforcing*
   safety decision (MPS/fidelity when evaluated + the deterministic
   dropped-numbers guard) and *advisory* signals (churn, persona-match). A safety
   failure sets a non-zero exit (4), non-destructively — output is still emitted.
   Churn and persona-match warn but never block (`personas/gates.js`,
   `run.js` persona block).
2. **Lane B reuses `verify.js`'s real scores.** When `--verify` runs, the persona
   safety gate consumes its scored MPS/fidelity instead of the backend's
   self-reported JSON; without `--verify` it falls back to the deterministic
   backstop (dropped-numbers + advisory churn), never silently passing an
   unmeasured floor.
3. **The two verification paths share one decision.** `verify.js` and the persona
   safety gate no longer score independently — the gate consumes verify's scores
   (single path when both are active).
4. **Churn reclassified from safety to advisory.** Live calibration showed
   legitimate KO humanizing rewrites churn ~0.5–0.85 while preserving meaning, so
   surface churn is not a meaning signal; it warns only. `mps_floor`/`fidelity_floor`
   stay core (70, enforcing); `churn_max`/`persona_match_min` are observation-
   informed advisory thresholds. (`source` stays `placeholder` — advisory tuning,
   not a formal 2-round promotion.)
5. **Personas are multilingual and are the sole voice owner.** `--persona` runs on
   ko/en/zh/ja. As of v6.2 the persona owns ALL voice: whenever a persona is
   active (including the `preserve` default), the profile contributes only its
   pattern policy and its voice body is not sent to the model. Profiles were
   reduced to a pattern-policy-only axis (`voice-overrides` frontmatter removed,
   voice-guidance bodies dropped, versions bumped); a runtime migration warning
   fires when a non-default profile is used for a rewrite without a voice-owning
   persona. Register precedence stays `--tone` > persona > profile. (persona
   schema still forbids pattern control — that half stays.)

### Remaining

- **`ouroboros.js` does not consume `persona-match`.** The iterative rewrite
  helper (no longer on the default CLI path — `--verify` replaced it) ignores
  persona drift.
- **No deterministic MPS/fidelity proxy.** Without `--verify` (or a
  backend-reported score) Lane B's meaning floors are not enforced by code;
  `persona-match` + dropped-numbers are the only always-on Method-D anchors.
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
