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
  - hosted surface: browser playground + Pro HTTP API at `patina.vibetip.help` (`docs/HTTP-API.md`); Pro checkout via Polar since 2026-08-04 (`docs/operations/live-open-20260804.md`); container image `ghcr.io/devswha/patina:latest` (`docs/integrations/docker.md`)

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

## 1. Quality roadmap

### Phase 1 — benchmark credibility

Status (2026-09-02): shipped. `docs/benchmarks/latest.md` carries Wilson CIs, ROC-AUC / PR-AUC and threshold diagnostics; register split lives in `docs/benchmarks/register-stratified-latest.md`; the adversarial MPS gate is `docs/research/adversarial-mps.md`. Remaining: keep the reports regenerated after deterministic-layer changes (the 8.1.0 Korean modules post-date the 2026-06-14 `-latest` reports).

Goal: make claims easier to verify and harder to dismiss.

- Publish a short benchmark report generated from `tests/quality/results.json`.
- Keep ROC-AUC / PR-AUC and threshold sweep diagnostics current in the deterministic benchmark report.
- Split reports by language, class, and register.
- Add a visible warning that scores measure AI-likeness, not authorship.
- Link [`docs/research/ai-human-metrics.md`](research/ai-human-metrics.md) from README.
- Keep the adversarial MPS report current so high meaning preservation cannot hide unchanged AI-like style.

Acceptance criteria:

- `npm run benchmark` still passes.
- `npm run quality:adversarial-mps` still passes.
- Benchmark output includes current binary metrics plus ranked/threshold metrics.
- README claims are traceable to a specific benchmark report or spec section.

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

Status (2026-09-02): in research. The Korean diagnosis modules (`src/features/korean-diagnosis.js`, `korean-invariants.js`, `korean-structure-fingerprint.js`) landed in 8.1.0 as research infrastructure and are **not** promoted to the shipped verdict (`docs/research/ko-confirmatory-verdict-20260901.md`). The smoothness-floor trigger below (payment open) has fired since 2026-08-04; the item is still roadmap-only.

Goal: add signals that are not just sentence length or lexicon hits.

Candidate features:

- function-word divergence
- punctuation rhythm
- sentence opener diversity
- Korean passive/nominalization proxies
- paragraph shape variation
- **sentence-length / line-rhythm smoothness floor** (advisory): flag output whose sentence-length CV, line-length CV, or line-ending entropy falls **below** a human band — the "too smooth / over-edited" lower bound, distinct from the existing detection-side burstiness signal. Ship advisory-first (like the meaning proxy Phase A): warning only, no exit-code or gate change, no `analyzeText` coupling, so the benchmark stays unaffected. Reuses the burstiness CV already computed in `src/features/*`.
  - Trigger: implementation starts only after payment is open and the launch is complete (P0 = payment/launch); adopted here as roadmap only. Idea from `kimsh-1/gn-voice` (`scripts/verify_style.py` smoothness lower-bound; MIT — Section A). Credit in `NOTICE` if its formula is reused.

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

### Phase 1 — try-it-now experience

Status (2026-09-02): shipped. Hosted playground at <https://patina.vibetip.help/> (server-side rewrite, `docs/HTTP-API.md`), preview GIF hero in every README, brand assets in `assets/brand/` (`docs/BRANDING.md`).

Goal: reduce the time from landing on README to seeing value.

- Maintain the recognizable patina logo / app icon now in `assets/brand/`.
  It should stay dark, faceted, tactile, and simple enough to work at favicon size,
  without copying Obsidian's trade dress.
- Add an animated terminal demo or short GIF.
- Add copy-paste sample commands for the 4 most likely users:
  - writer/blogger
  - engineer writing docs
  - Korean marketer/social writer
  - researcher/academic writer
- Add a `--sample` or documented sample file flow if not already available.

Acceptance criteria:

- A new user can run one command and see before/after output in under 2 minutes.
- README demo covers both CLI and skill usage.
- Logo assets exist in repo-friendly formats (`svg` source plus social preview export) and render clearly on GitHub dark/light backgrounds.

### Phase 2 — packaging and distribution

Status (2026-09-07): the source/web release is 8.5.1; npm `patina-cli` and `patina-humanizer` remain at 8.3.0 while publication is on hold. GitHub Releases follow successful npm publication on tag push (`docs/integrations/release.md`). The public image `ghcr.io/devswha/patina:latest` has a separate manual release path (`docs/integrations/docker.md`). Homebrew has not started.

Goal: make patina installable from the channels users expect.

- Publish npm package if the project is ready for package support.
- Add signed GitHub releases and changelog highlights.
- Consider Homebrew only after npm and releases are stable.
- Add package badges only after packages exist.

Acceptance criteria:

- Install instructions work from a clean environment.
- Release artifacts match README claims.
- Version-bearing files stay synchronized.

### Phase 3 — integrations

Status (2026-09-02): shipped for the first-class paths — Claude Code / Codex / Cursor / OpenCode skill install, `devswha/patina-action`, pre-commit and static-site recipes under `docs/integrations/`. Subagent strict flow: `docs/agents.md`.

Goal: make patina show up where AI-writing pain happens.

- Claude Code / Codex / Cursor / OpenCode install path stays first-class.
- Add examples for docs cleanup, blog rewrite, and launch-copy cleanup.
- Consider editor snippets or action recipes after CLI packaging is stable.

Acceptance criteria:

- Integration docs are tested manually before public launch posts.
- Each integration has one minimal example and one realistic example.

### Phase 4 — custom Persona authoring (shipped in 7.0.0)

The shipped axis contract is explicit:

- Document Type owns genre, purpose, structural conventions, and pattern policy.
- Persona v2 is optional and owns only reusable voice.
- Register owns only `casual` or `professional` delivery.
- Meaning preservation and verification are global; no axis can weaken them.

`patina persona new|list|show|edit|rm` covers the custom Persona lifecycle in
ko/en/zh/ja. Omitting `--persona` preserves the source voice. The v7 CLI rejects
the retired `--profile`, `--tone`, and `--formality` inputs with migration
errors rather than aliases.

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

## 3. Community roadmap

### Phase 1 — community health basics

Status (2026-09-02): shipped. `.github/ISSUE_TEMPLATE/` holds bug, feature, pattern-proposal, false-positive, benchmark-corpus, calibration-concern and research-proposal forms; `SECURITY.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md`, `GOVERNANCE.md`, `MAINTAINERS.md` and the PR template exist.

Goal: make the project safe and easy to contribute to.

- Add issue templates:
  - bug report
  - pattern proposal
  - false positive report
  - benchmark/corpus proposal
- Add PR template.
- Add `SECURITY.md`.
- Add `SUPPORT.md`.
- Add `CODE_OF_CONDUCT.md`.

Acceptance criteria:

- GitHub community profile is no longer missing basic files.
- Pattern proposals ask for examples, language, false-positive risk, and expected rewrite.

### Phase 2 — contribution flywheel

Status (2026-09-02): open. No labelled starter-issue programme or "pattern of the week" cadence is recorded; pattern PR requirements live in `CONTRIBUTING.md`.

Goal: turn users into pattern contributors.

- Label starter issues:
  - `good first issue`
  - `patterns`
  - `benchmark`
  - `docs`
- Add a “submit a pattern” path from README and FAQ.
- Publish small “pattern of the week” examples.

Acceptance criteria:

- A contributor can add a pattern by following docs without asking the maintainer.
- Pattern PRs include success/failure examples.

## 4. Launch roadmap

Status (2026-09-02): the public launch and the Pro checkout opening (2026-08-04) are complete; the checklist and surface table below are kept as the standing rule for any future launch post. Operational evidence: `docs/operations/pro-launch.md`, `docs/operations/live-open-20260804.md`. Launch copy drafts were removed from the public tree on 2026-09-02; only `docs/social/signs-of-ai-writing.md` (dogfooded checklist) remains.

### Pre-launch checklist

- README has a crisp one-line promise.
- Patina logo / icon exists and appears in README/social preview surfaces.
- Demo GIF or terminal recording exists.
- Benchmark report is linked.
- Install path is tested.
- Issue templates are ready.
- At least 3 polished real-world examples exist.

### Launch surfaces

Use one clear story per surface.

| Surface | Angle |
|---|---|
| Hacker News / Show HN | Auditable AI-writing humanizer with benchmarked meaning preservation |
| Reddit writing communities | Remove AI packaging without changing your claims |
| Korean developer/writer communities | Korean-first AI prose cleanup, not just English detector talk |
| GitHub social/X | Pattern catalog + before/after demos |
| AI coding communities | Works as Claude Code/Codex/Cursor/OpenCode skill |

### Launch rule

Do not lead with “bypass AI detectors.” Lead with:

> AI-assisted writing often sounds packaged. patina removes that packaging and checks that the meaning survived.

## 5. Current state and next actions

Last refreshed: 2026-09-08. GitHub issues are the source of truth for open
work; this section records only standing decisions and where their evidence
lives, so nobody re-triages from a stale snapshot.

### Standing decisions

- **Payment: Polar only.** Lemon Squeezy declined the store application (a
  risk-underwriting decision, not a policy breach) (`docs/internal/payment-provider-reset-20260729.md` (maintainer-private)); Pro
  checkout opened on production via Polar on 2026-08-04
  (`docs/operations/live-open-20260804.md`); 8.0.0 removed the Lemon Squeezy
  code paths (CHANGELOG). Rollback: `docs/operations/rollback-drills.md`.
- **Serving engines.** Pro tier pin: `gemini-3.6-flash`; `gemini-3.7-flash`
  allowlisted opt-in after the 2026-08-13 head-to-head
  (`docs/operations/serving-engine-gemini-3.7-flash-20260813.md`,
  `src/web-rewrite-contract.js`). Free tier: **gemini** (owner-confirmed 2026-09-02); the 2026-08-03
  deepseek flip (`docs/operations/free-tier-deepseek-flip-20260803.md`,
  CHANGELOG 7.0.0) is superseded, and the live engines remain deployment env
  values (`PATINA_FREE_MODEL`, `PATINA_PRO_MODEL`). Cost evidence chain:
  `serving-engine-cost-20260725.md` → `serving-engine-deepseek-0731-correction-20260803.md`.
- **Register-failure diagnosis (closed 2026-07-27):** the apparent
  cross-engine register failures were measurement-apparatus bugs (fidelity
  rubric, persona-less harness prompt); fixing both took the same engine from
  9/22 to 20/22 fixtures (`docs/operations/register-failure-handoff-20260726.md`).
  Still recorded as open there: `en-marketing-01` (AI 35.6 → 5.7 but MPS 60)
  and `en-public-docs-01` (meaning kept, AI 15.6 → 16.5) — add a second
  fixture per register before treating either as a register-wide pattern.

### Research programme

- Performance-only order frozen 2026-09-01 in
  `docs/research/humanization-data-backlog.md`. Step 1 (KO GPT-family
  miss-review manifest) is complete per the September 7 ledger
  (`docs/operations/remaining-work-20260905.md`); its session handoff stays
  maintainer-private (`docs/internal/ko-gpt-miss-review-handoff-20260902.md`).
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
- #212: export and licensing tools are implemented, but publication was deferred
  and the issue was closed as `not_planned`. Closure is not evidence of a public
  Hugging Face upload.
- The [Aside integration](integrations/aside.md#validation-boundary) is available
  in the source checkout. Native macOS/Aside acceptance remains unverified.
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
