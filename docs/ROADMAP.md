# patina Roadmap

patina's goal is not to accuse authors or prove provenance. It is to make AI-assisted writing sound less packaged while preserving meaning.

This roadmap focuses on two things:

1. make the tool measurably better;
2. make the project easier to trust, try, cite, and contribute to.

## Current baseline

- GitHub: `devswha/patina`
- Public scope: Korean, English, Chinese, Japanese AI-writing pattern rewriting
- Current benchmark layer:
  - deterministic stylometry/lexicon benchmark: `npm run benchmark`
  - adversarial MPS fixture gate: `npm run quality:adversarial-mps`
  - 2026 rebaseline status: [`docs/research/2026-rebaseline.md`](research/2026-rebaseline.md)
- Current public calibration claim:
  - 2026-05-22 modern-model catch: 67.3% [63.5-71.0%], n=600 across KO+EN × GPT/Claude/Gemini
  - human-control false positives: 16.0% [11.6-21.7%], n=200 across KO+EN
  - per-cell results: `docs/benchmarks/rebaseline-latest.md`
- Current distribution:
  - npm package `patina-cli` is the public distribution channel; repo metadata (package.json / SKILL.md / README) is version-synced and verified with `npm run release:check` before publishing.
  - hosted surface: browser playground + Pro HTTP API at `patina.vibetip.help` (`docs/HTTP-API.md`); Pro checkout via Polar since 2026-08-04; container image `ghcr.io/devswha/patina:latest` (`docs/integrations/docker.md`)

## 0. Positioning principles

### What patina is

- An auditable AI-writing-pattern humanizer
- A multilingual pattern catalog for AI-sounding prose
- A meaning-preserving rewrite workflow
- A benchmarked quality layer for humanization, not authorship accusation

### What patina is not

- A disciplinary AI detector
- A provenance proof system
- A promise that a text was or was not written by AI
- A detector-bypass product for academic or professional dishonesty

Public copy should prefer terms like:

- AI-likeness
- AI-like writing signals
- suspect zones
- meaning preservation
- humanization gain

Avoid overclaiming:

- AI probability
- written by AI
- guaranteed undetectable
- bypass detector

### Launch rule

Do not lead with “bypass AI detectors.” Lead with:

> AI-assisted writing often sounds packaged. patina removes that packaging and checks that the meaning survived.

## Shipped

- **Benchmark credibility (quality phase 1).** `docs/benchmarks/latest.md` carries Wilson CIs, ROC-AUC / PR-AUC and threshold diagnostics; the register split is `docs/benchmarks/register-stratified-latest.md`; the adversarial MPS gate is `docs/research/adversarial-mps.md`. `katfish-ko-latest` (2026-05-21) is frozen as historical evidence: regenerating it needs the private KatFish inputs, which the owner retired on 2026-09-15, so it is not pending work.
- **Try-it-now experience.** Hosted playground at <https://patina.vibetip.help/> (server-side rewrite, `docs/HTTP-API.md`); brand assets in `assets/brand/` (`docs/BRANDING.md`).
- **Packaging and distribution.** npm `patina-cli` and `patina-humanizer` publish through npm Trusted Publishing (OIDC); every publication still needs separate, explicit external-write authorization. GitHub Releases follow a successful npm publication on tag push (`docs/integrations/release.md`). The public image `ghcr.io/devswha/patina:latest` has its own manual release path (`docs/integrations/docker.md`). The README Quick Start states the current source and npm versions. Homebrew has not started.
- **Integrations.** Claude Code / Codex / Cursor / OpenCode skill install, `devswha/patina-action`, and the pre-commit recipe under `docs/integrations/`. Subagent strict flow: `docs/agents.md`.
- **Custom Persona authoring (7.0.0).** Document Type owns genre, purpose, structural conventions, and pattern policy; Persona v2 is optional and owns only reusable voice; Register owns only `casual` or `professional` delivery; meaning preservation and verification are global. `patina persona new|list|show|edit|rm` covers the lifecycle in ko/en/zh/ja. Omitting `--persona` preserves the source voice, and the v7 CLI rejects `--profile`, `--tone`, and `--formality` with migration errors rather than aliases.
- **Community health.** Issue forms for bugs, features, pattern proposals, false positives, benchmark corpora, calibration concerns and research proposals; `SECURITY.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md`, `GOVERNANCE.md`, `MAINTAINERS.md` and the PR template.
- **Contribution path.** A “submit a pattern” path from README and FAQ, [`docs/community/pattern-of-the-week.md`](community/pattern-of-the-week.md), and the starter labels `good first issue`, `patterns`, `benchmark`, and `docs`. Pattern PR requirements stay in `CONTRIBUTING.md`.
- **Public launch and Pro checkout** (Polar, 2026-08-04).

## 1. Quality roadmap

### Phase 2 — corpus expansion

Status (2026-09-02): partial. KO/EN reached the 2026 rebaseline gate (`docs/research/2026-rebaseline.md`); ZH/JA public coverage and the edited-AI class are still empty — tracked as steps 2 and 8 of the frozen order in `docs/research/humanization-data-backlog.md`.

Goal: reduce synthetic-fixture overfitting.

- Add real-world human prose fixtures by register:
  - encyclopedic
  - blog/essay
  - news/reporting
  - academic/technical
  - marketing/social
- Add generated prose fixtures by model family:
  - GPT
  - Claude
  - Gemini
  - open-weight models where feasible
- Add edited-AI fixtures:
  - paraphrased
  - translated roundtrip
  - lightly human-edited

Acceptance criteria:

- At least 100 human + 100 AI paragraphs per primary language before promoting new headline benchmark claims.
- False positives are reported per register, not only as a single aggregate.
- Existing headline thresholds remain honest if performance drops.

### Phase 3 — deterministic feature expansion

Status (2026-09-02): in research. The Korean diagnosis modules (`src/features/korean-diagnosis.js`, `korean-invariants.js`, `korean-structure-fingerprint.js`) landed in 8.1.0 as research infrastructure and are **not** promoted to the shipped verdict (`docs/research/ko-confirmatory-verdict-20260901.md`). The smoothness-floor item is **shipped advisory (CLI rewrite warning); not in analyzeText / benchmark**. Remaining Phase 3 candidates stay research-only.

Goal: add signals that are not just sentence length or lexicon hits.

Candidate features:

- function-word divergence
- punctuation rhythm
- sentence opener diversity
- Korean passive/nominalization proxies
- paragraph shape variation
- **sentence-length / line-rhythm smoothness floor** (advisory): shipped advisory (CLI rewrite warning); not in analyzeText / benchmark. Flags rewrite output whose sentence-length CV, line-length CV, or line-ending entropy falls **below** a human band — the "too smooth / over-edited" lower bound, distinct from the existing detection-side burstiness signal. Warning only (`src/cli/smoothness-advisory.js`); no exit-code or gate change; missing `smoothness-floor` key is enabled. Reuses `burstinessCV`; line CV / ending entropy are local (no gn-voice NOTICE credit).
- **rewrite overcorrection guard** (advisory): shipped advisory (CLI rewrite warning); not in analyzeText / benchmark. The mirror of the smoothness floor — it compares SOURCE to OUTPUT and notes when a rewrite traded one slop class for another: every typographic dash removed from a dash-leaning source, or slang the source never used appearing in the rewrite (en/ko). Warning only (`src/cli/overcorrection-advisory.js`); no exit-code, text, or gate change; missing `overcorrection-guard` key is enabled. Deliberately not a dash ban — one surviving dash clears the check, and a source with fewer than two dashes is never judged (#882).

Acceptance criteria:

- New features improve recall or precision on expanded corpus.
- New features do not raise max human false positives beyond the published tolerance.
- Each feature has before/after examples and a documented failure mode.

### Phase 4 — optional LM-probability research

Status (2026-09-02): unchanged; no LM-probability track started. Literature context: `docs/research/humanization-literature-2026-09.md` §1 and §8.

Goal: experiment without making the default tool heavy.

Candidate tracks:

- GLTR-style rank/probability/entropy visualization
- Binoculars-style cross-perplexity contrast
- DetectGPT-style curvature experiments

Acceptance criteria:

- Implemented only as optional research scripts or docs unless they prove lightweight and stable.
- No default dependency bloat.
- No user-facing provenance claims.

## 2. Product roadmap

### Persona personalization

Later work, not shipped behavior:

- **Corpus-distilled quantitative bands**: a separately approved
  `persona new --from-corpus <dir>` path could derive per-metric allow-bands from
  the user's own corpus using LLM-free stylometry.
- **Personalized avoided lexicon**: derive a Persona's avoid list from terms
  absent from the user's corpus.
- **Holdout validation**: reserve part of the user's corpus to verify that a
  derived voice fingerprint generalizes before offering it.

These larger personalization paths remain gated behind payment stabilization
and separate approval.

## 3. Current state and next actions

Last refreshed: 2026-09-08. GitHub issues are the source of truth for open
work; this section records only standing decisions and where their evidence
lives, so nobody re-triages from a stale snapshot.

### Standing decisions

- **Payment: Polar only.** Lemon Squeezy declined the store application (a
  risk-underwriting decision, not a policy breach); Pro checkout opened on
  production via Polar on 2026-08-04; 8.0.0 removed the Lemon Squeezy
  code paths (CHANGELOG). Rollback: `docs/operations/rollback-drills.md`.
- **Serving engines.** Pro tier pin: `gemini-3.6-flash`; `gemini-3.7-flash`
  allowlisted opt-in after the 2026-08-13 head-to-head
  (`docs/operations/serving-engine-gemini-3.7-flash-20260813.md`,
  `src/web-rewrite-contract.js`). Free tier: **gemini** (owner-confirmed 2026-09-02); the 2026-08-03
  deepseek flip (CHANGELOG 7.0.0) is superseded, and the live engines remain deployment env
  values (`PATINA_FREE_MODEL`, `PATINA_PRO_MODEL`). Cost evidence chain:
  `serving-engine-cost-20260725.md` → `serving-engine-deepseek-0731-correction-20260803.md`.
- **Register-failure diagnosis (closed 2026-07-27):** the apparent
  cross-engine register failures were measurement-apparatus bugs (fidelity
  rubric, persona-less harness prompt); fixing both took the same engine from
  9/22 to 20/22 fixtures. Still open: `en-marketing-01` (AI 35.6 → 5.7 but MPS 60)
  and `en-public-docs-01` (meaning kept, AI 15.6 → 16.5) — add a second
  fixture per register before treating either as a register-wide pattern.

### Research programme

- Performance-only order frozen 2026-09-01 in
  `docs/research/humanization-data-backlog.md`. Step 1 (KO GPT-family
  miss-review manifest) is complete
  (`docs/research/ko-gpt-miss-review-step1-decision-20260902.md`,
  `docs/benchmarks/ko-gpt-miss-review-v1.md`).
  The registered downstream sequence is not an active execution queue.
  The owner cancelled the previously deferred human panel (#159) and
  human-labeled short-form corpus (#643) on 2026-09-08. Both issues are closed
  `not_planned`; their cancellation does not activate other research.
- Rewrite-efficacy study series: `2026-rewrite-efficacy-study1.md` (EN doc
  −23.4, KO doc −6.0), `study2.md` / `study3.md` (structure pack and plan-step
  both failed; nothing shipped), `2026-rewrite-efficacy-study4.md` (complete;
  the specificity constraint was not supported in either language, nothing
  shipped). Judge panel: `2026-judge-calibration.md`,
  `2026-panel-v2-design.md`. Korean program verdict:
  `ko-confirmatory-verdict-20260901.md`. External literature survey:
  `humanization-literature-2026-09.md`.
- #159 blinded human panel, formerly step 3 of the frozen order, was cancelled
  without running the panel. Its design is retained as history
  (`docs/research/human-eval-panel.md`). #158 cross-judge matrix was closed
  2026-07-12 as answered by Study 1's cross-family panel agreement
  (α 0.751 en / 0.526 ko); `2026-judge-calibration.md` adds per-judge AUC and
  self-preference.

### Ecosystem status

Checked 2026-09-08 against the issue records and the [editor client record](integrations/editors.md):

- #206: VS Code 1.1.0 shipped as a VSIX and the issue is complete. The client
  was retired on 2026-09-08 with the other first-party editor clients.
- #211: community-pack commands and the starter repository shipped in 8.2.0;
  the issue is complete. The starter repository was archived and its local
  copy deleted on 2026-09-08; the optional community-pattern CLI commands
  were removed in source commit 31ae86e.
- #207: Obsidian 1.0.0 and host/backend checks are complete; the client was
  retired on 2026-09-08. Community directory submission is classified not
  planned, and the issue was closed as not planned on 2026-09-08.
- #284: the Gmail preview was released and retired on 2026-09-08. Signed-in
  Gmail acceptance, Chrome Web Store, Notion and LinkedIn are classified not
  planned, and the issue was closed as not planned on 2026-09-08.
- #212: no Hugging Face dataset was published; the issue was closed as
  `not_planned`.
- The [Aside integration](integrations/aside.md#validation-boundary) is available
  in the source checkout. Native macOS/Aside desktop acceptance was abandoned
  by the owner on 2026-09-14 (`not_planned`); Linux CLI evidence is not a
  desktop proof.
- #772 (CLI-first skill execution with execution evidence) has source
  implementation present in this non-npm change, including the helper,
  installer runtime checks and default skill routing. Existing targeted tests
  had passed at the September 8 pre-acceptance/pre-merge checkpoint; real
  CLI/agent acceptance and final PR review/integration gates were still pending.
  The issue was open; no final PR merge, deployment or npm release had happened
  in this change at that checkpoint. See #772, its associated PR and CI for
  later acceptance and integration evidence.

The owner's 2026-09-08 cancellation of #159 and #643 supersedes their
[September 6 deferral](https://github.com/devswha/patina/issues/643#issuecomment-5559803306).
They are not pending work and require a new explicit request before resuming.
Their human acceptance criteria remain unmet. Retained automation-only
diagnostics keep unknown labels unknown; cancellation does not establish human
false-positive or false-negative rates.

### Operating rules

- Launch posts and public claims cite checked-in benchmark reports and the
  sanitized rebaseline report; they never claim broader generalization.
- Any scoring-threshold change updates benchmark ranges and dogfood evidence in
  the same change.
- KO/2025+ raw text stays in `artifacts/rebaseline-2025/` or another private
  store; only redistributable examples, hashes, metadata and aggregate reports
  are committed.
- External-account actions (HN, Reddit, X, Threads, LinkedIn) are
  maintainer-owned; the repo holds evidence, not posting queues.
