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

Goal: make patina show up where AI-writing pain happens.

- Claude Code / Codex / Cursor / OpenCode install path stays first-class.
- Add examples for docs cleanup, blog rewrite, and launch-copy cleanup.
- Consider editor snippets or action recipes after CLI packaging is stable.

Acceptance criteria:

- Integration docs are tested manually before public launch posts.
- Each integration has one minimal example and one realistic example.

### Phase 4 — custom voice authoring

Goal: let users define their own persona / genre / tone instead of supplying raw style samples.

- Build on the existing persona harness (`src/personas/`, `personas/ko/`) and the `--persona` / `--tone` / `--profile` axes rather than a separate sample-injection path.
- Provide an authoring entry point so a user can create and reuse a named custom persona (voice + register + genre) with the same MPS/fidelity floors enforced.
- This replaces the removed `--voice-sample` style anchor (dropped in 6.0.0): the "sound like me" use case becomes a saved custom persona, not a per-run sample file.
- **Corpus-distilled quantitative bands**: a `persona new --from-corpus <dir>` path that ingests a multi-document personal corpus and distills per-metric allow-bands (p5/p95) from patina's existing deterministic stylometry (burstiness / MATTR / lexicon density / line rhythm) — promoting a persona from qualitative blocks to a quantitative, verifiable voice fingerprint, optionally segmented by genre/channel. Bands live in `src/features/*` (LLM-free); the persona still cannot lower the MPS/fidelity floors.
- **Personalized avoided-lexicon**: derive a persona's `avoid` list from the user corpus's zero-occurrence terms (a personal AI-tell dictionary), complementing the generic corpus-grounded AI lexicon.
- **Holdout validation methodology**: seal ~15% of the user corpus, build bands only on the rest, and verify a distilled persona generalizes to the unseen holdout (plus a corpus manifest/ledger integrity check) before it is offered.
- Trigger + attribution: a large effort that competes with the payment/launch path — implementation starts only after payment stabilization and a **separate** approval. The genre×channel fingerprint bands, personalized zero-occurrence tells, and holdout/ledger methodology are adopted (idea-level) from `kimsh-1/gn-voice` (MIT — Section A: `scripts/`, `references/fingerprint-slim.json`, `references/ai-tells.json`, `style-profile/`). patina distills only the user's own corpus and never ingests gn-voice's `corpus/`, `analysis/`, or `examples/` (Section B, all rights reserved). Credit gn-voice in `NOTICE` if any Section A structure is reused.

Acceptance criteria:

- A user can author, save, and select a custom persona without editing source.
- Custom personas honor the same meaning-preservation/fidelity hard floors as bundled personas.
- No regression to the conservative `preserve` default for users who do not author one.

## 3. Community roadmap

### Phase 1 — community health basics

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

## 5. Immediate next actions

Last triaged: 2026-06-05, after closing the public launch tracker and moving launch posting notes out of GitHub issues.

Current GitHub issue inventory:

- 9 open issues.
- Open PRs: 0.
- Open priority split: 0 high, 1 medium, 8 low, and 0 without priority labels.
- No current high-priority issue.

Campaign state:

- Merged campaign PRs: #281, #287, #288, #289, #290, #292, #293.
- Concurrent cleanup merged during the final gate: #294 closed #291.
- Final review blocker cleanup: #295.
- Launch Wave 1 badge work: #297 closed #282; companion patina-action#1 added `badge-json` / `badge-branch`.
- Launch Wave 2 support work: #299 closed #285; the experimental share-card generator from #283 has since been removed from the CLI surface.
- Launch Wave 3 static playground work closes #208 and targets <https://patina.vibetip.help/> for the try-it-now URL.
- Launch execution prep: Korean-first channel drafts live in `docs/social/patina-launch-korean-first.md` and score 0.0%; `docs/social/patina-launch-copy.md` scores 6.3% after the KO diagnostic scoring update. Launch posting/deferral notes are maintainer-owned operational bookkeeping and should be tracked outside public GitHub issues.
- Rebaseline claim pass: `npm run benchmark:rebaseline:report` refreshes `docs/benchmarks/rebaseline-latest.{md,json}` from the #155 claim-ready sanitized manifest (800 rows, no raw text).
- KO/2025+ corpus prep: `docs/research/ko-2025-corpus-sources.md` records usable Korean sources, `artifacts/rebaseline-2025/intake.local.example.jsonl` provides the 25-row pilot skeleton, `artifacts/rebaseline-2025/sources.ko-public.jsonl` inventories public Korean web sources, `artifacts/rebaseline-2025/human-controls.public.jsonl` tracks 250 scored hash-only web human-control candidates at n=50 for each tracked register, `npm run benchmark:rebaseline:web` collects raw text into ignored private rows, and `npm run benchmark:rebaseline:score` refreshes deterministic outcome fields without copying raw text.
- KO register pilot: `npm run benchmark:register-pilot -- --write --basename register-stratified-latest` refreshes false positives by register without committing raw text; the expanded current pilot shows 42/250 predicted-hot human-control rows, split by register for threshold work.
- KO KatFish calibration: `npm run benchmark:katfish-ko -- --write --basename katfish-ko-latest` reports aggregate-only private KatFish metrics; current KO diagnostics improve catch rate from 58.9% to 74.8% versus Patina without KO diagnostics while public-web human-control FP stays 42/250.
- Launch feedback prep: the false-positive issue form now captures text origin, redistribution, fired paragraph, score output, and expected behavior.
- Growth nudge prep: the one-time CLI star reminder from #305 has since been removed to keep stderr operational-only.
- README demo prep: #306/#308 terminal GIF work has been superseded by the preview-first README hero. The current viral-facing README sample uses `assets/demo/patina-preview-en.gif` across English, Korean, Chinese, and Japanese docs to show the real `--preview` page, inline diff, toggles, and score before → after.
- Closed or verified during the campaign: #99, #104, #155, #156, #157, #160, #303, #165, #186, #191, #199, #209, #210, #286, #304, #305, #306, #308.
- Kept open with explicit blocker comments or pending external action: #158, #159, #206, #207, #211, #212, #284, #307, #324.
- Legacy bot/harness notes were removed from the public repo; restart autonomous bot work only from a fresh, tracked design if it becomes necessary.
- Payment processor decision (2026-07-23, owner-agreed): ship Pro on Lemon
  Squeezy — the store is active and the go-live path is mechanical. A Polar
  migration (lower fees: 4%+$0.40 vs 5%+$0.50; stronger support reputation) is
  deliberately deferred and becomes an agenda item only when either trigger
  fires: (a) MRR exceeds $500, or (b) a concrete LS support/payout failure.
  The entitlement layer stays provider-agnostic (injected license validator,
  env-driven checkout URL) so an adapter remains bounded work; do not build it
  speculatively before a trigger fires.

Next recommended order:

1. Prepare #307 awesome-list discovery submissions only as candidate copy/checklists; maintainer-owned external submissions should stay outside automated repo changes.
2. Re-implement #324 only when live credentialed quality checks are worth the larger local-runner investment.
3. Treat low-priority research/ecosystem items (#158, #159, #206, #207, #211, #212, #284) as parked until evaluator budget, reviewer pool, redistributable corpus, external repo, hosting, or governance prerequisites exist; keep new campaign PRs short-lived.

Detailed wave grouping lives in `docs/ISSUE-WAVES.md` so launch/growth, completed profile work, evaluation-gated research, and parked ecosystem work can move independently without re-triage.
