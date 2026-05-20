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
- Current public calibration claim:
  - Korean editing-hotspot recall: 91% [84.0-95.4%], n=100
  - English HC3 editing-hotspot recall: 76% [66.7-83.3%], n=100
  - human false positives: 13-25% point-estimate range across registers
- Current distribution gap:
  - package name `patina-cli` is not published on npm as of 2026-05-20

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
- Add ROC-AUC / PR-AUC and threshold sweep to the deterministic benchmark.
- Split reports by language, class, and register.
- Add a visible warning that scores measure AI-likeness, not authorship.
- Link [`docs/research/ai-human-metrics.md`](research/ai-human-metrics.md) from README.

Acceptance criteria:

- `npm run benchmark` still passes.
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

Last triaged: 2026-05-21, after MAX stabilization closed issues #141, #143, and #144.

Current GitHub issue inventory:

- 20 open issues; 122 closed issues; 142 tracked issues total.
- Open priority split: 0 high, 7 medium, 13 low, and 0 without priority labels.
- No `priority: high` issues are currently open.

Already done or mostly done:

- README links to the roadmap, research notes, benchmark report, detector comparison, demo, launch copy, and community docs.
- Issue templates, PR template, `SECURITY.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md`, and `CONTRIBUTING.md` exist.
- Benchmark report generation exists via `npm run benchmark:report`.
- Logo, icon, and social preview SVGs live in `assets/brand/` and `assets/social/`.
- A copy-paste terminal demo lives in [`docs/DEMO.md`](DEMO.md).
- Launch copy drafts live in [`docs/social/patina-launch-copy.md`](social/patina-launch-copy.md).
- Main branch protection is enabled. Issue: [#246](https://github.com/devswha/patina/issues/246).
- MAX warns when every MAX candidate fails `MPS >= 70` and the highest-MPS candidate is selected as fallback. Issue: [#139](https://github.com/devswha/patina/issues/139).
- MAX stabilization is complete: standalone MAX accepts local CLI backend candidates, defaults to minimal prompt weight, and documents pane-liveness watchdog behavior. Issues: [#141](https://github.com/devswha/patina/issues/141), [#143](https://github.com/devswha/patina/issues/143), [#144](https://github.com/devswha/patina/issues/144).
- Deterministic `callLLM` seams exist across `ouroboros`, `max-mode`, and scoring test paths. Issue: [#130](https://github.com/devswha/patina/issues/130).
- Localized READMEs have been dogfooded through patina to reduce AI tells. Issue: [#242](https://github.com/devswha/patina/issues/242).
- zh/ja before-after examples have been backfilled to near parity with ko/en pattern coverage. Issue: [#146](https://github.com/devswha/patina/issues/146).
- External promotional / solicitation issue policy is documented. Issue: [#245](https://github.com/devswha/patina/issues/245).
- README hero block is centered. Issue: [#241](https://github.com/devswha/patina/issues/241).
- Korean companion docs exist for contributing, FAQ, authentication, and examples. Issue: [#202](https://github.com/devswha/patina/issues/202).
- Priority labels were added for the last unlabeled queue items. Issues: [#99](https://github.com/devswha/patina/issues/99), [#104](https://github.com/devswha/patina/issues/104).
- Test/backend hardening wave is complete: prompt snapshots, backend contract unification, SIGINT cancellation, structured logging, and progress indicators. Issues: [#169](https://github.com/devswha/patina/issues/169), [#131](https://github.com/devswha/patina/issues/131), [#133](https://github.com/devswha/patina/issues/133), [#132](https://github.com/devswha/patina/issues/132), [#180](https://github.com/devswha/patina/issues/180).
- Scoring/stylometry quality wave is complete: zh/ja char n-grams, deterministic shadow scoring, manifest v2 observability, response cache, and voice anchors. Issues: [#151](https://github.com/devswha/patina/issues/151), [#136](https://github.com/devswha/patina/issues/136), [#134](https://github.com/devswha/patina/issues/134), [#135](https://github.com/devswha/patina/issues/135), [#137](https://github.com/devswha/patina/issues/137).
- Pattern/profile wave is complete: zh/ja risk notes, comparison-adverb backport, zh/ja profile overrides, overlap audit, developer-prose profiles, and viral-hook expansion to 8 score-only patterns per language. Issues: [#147](https://github.com/devswha/patina/issues/147), [#148](https://github.com/devswha/patina/issues/148), [#149](https://github.com/devswha/patina/issues/149), [#152](https://github.com/devswha/patina/issues/152), [#153](https://github.com/devswha/patina/issues/153), [#154](https://github.com/devswha/patina/issues/154).

Next executable wave order (snapshot: 2026-05-21 after the MAX stabilization wave):

### Completed release wave

1. `patina-cli` / `patina-humanizer` are published on npm. Issue: [#203](https://github.com/devswha/patina/issues/203).
2. `devswha/patina-action@v1` is released for PR-comment scoring. Issue: [#204](https://github.com/devswha/patina/issues/204).

### Wave 1 — remaining medium, executable now

1. Add zh/ja AI-lexicon files for stylometry overlap detection. Issue: [#104](https://github.com/devswha/patina/issues/104).
2. Make `patina auth login <backend>` launch the real login flow. Issue: [#186](https://github.com/devswha/patina/issues/186).
3. Add JSDoc public exports and publish generated API reference. Issue: [#191](https://github.com/devswha/patina/issues/191).
4. Tie this roadmap to a GitHub Project board or Milestones. Issue: [#195](https://github.com/devswha/patina/issues/195).

### Wave 2 — research calibration, parked unless explicitly scheduled

These are medium-priority but research-heavy. Keep them out of the critical path until the remaining executable medium items and the core quality loop have stable owner time.

1. Re-baseline AI catch rate against 2025+ models. Issue: [#155](https://github.com/devswha/patina/issues/155).
2. Run the lexicon freshness audit with per-entry corpus provenance. Issue: [#160](https://github.com/devswha/patina/issues/160).
3. Establish quarterly pattern-freshness review with corpus refresh and emerging-pattern triage. Issue: [#165](https://github.com/devswha/patina/issues/165).

### Wave 3 — low-priority parked ecosystem and research

Do not start these until the remaining medium auth/docs work and research calibration wave have a stable release path:

- False-positive and benchmark calibration: [#99](https://github.com/devswha/patina/issues/99), [#156](https://github.com/devswha/patina/issues/156), [#157](https://github.com/devswha/patina/issues/157), [#158](https://github.com/devswha/patina/issues/158), [#159](https://github.com/devswha/patina/issues/159), [#163](https://github.com/devswha/patina/issues/163).
- Documentation site exploration: [#199](https://github.com/devswha/patina/issues/199).
- Editor/platform integrations and distribution experiments: [#206](https://github.com/devswha/patina/issues/206), [#207](https://github.com/devswha/patina/issues/207), [#208](https://github.com/devswha/patina/issues/208), [#209](https://github.com/devswha/patina/issues/209), [#210](https://github.com/devswha/patina/issues/210), [#211](https://github.com/devswha/patina/issues/211), [#212](https://github.com/devswha/patina/issues/212).
