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

Last triaged: 2026-05-20, after PR cleanup and live GitHub issue count refresh.

Current GitHub issue inventory:

- 45 open issues; 97 closed issues; 142 tracked issues total.
- Open priority split: 2 high, 28 medium, 13 low, and 2 without priority labels ([#99](https://github.com/devswha/patina/issues/99), [#104](https://github.com/devswha/patina/issues/104)).
- The only open `priority: high` issues are the blocked release-wave items [#203](https://github.com/devswha/patina/issues/203) and [#204](https://github.com/devswha/patina/issues/204).

Already done or mostly done:

- README links to the roadmap, research notes, benchmark report, detector comparison, demo, launch copy, and community docs.
- Issue templates, PR template, `SECURITY.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md`, and `CONTRIBUTING.md` exist.
- Benchmark report generation exists via `npm run benchmark:report`.
- Logo, icon, and social preview SVGs live in `assets/brand/` and `assets/social/`.
- A copy-paste terminal demo lives in [`docs/DEMO.md`](DEMO.md).
- Launch copy drafts live in [`docs/social/patina-launch-copy.md`](social/patina-launch-copy.md).
- Main branch protection is enabled. Issue: [#246](https://github.com/devswha/patina/issues/246).
- MAX warns when every MAX candidate fails `MPS >= 70` and the highest-MPS candidate is selected as fallback. Issue: [#139](https://github.com/devswha/patina/issues/139).
- Deterministic `callLLM` seams exist across `ouroboros`, `max-mode`, and scoring test paths. Issue: [#130](https://github.com/devswha/patina/issues/130).
- Localized READMEs have been dogfooded through patina to reduce AI tells. Issue: [#242](https://github.com/devswha/patina/issues/242).
- zh/ja before-after examples have been backfilled to near parity with ko/en pattern coverage. Issue: [#146](https://github.com/devswha/patina/issues/146).

Next executable wave order:

### Blocked release wave — keep visible, do not start yet

These are still the two open high-priority issues, but they are blocked until package ownership, release credentials, versioning, and support policy are settled.

1. Settle npm support policy, then publish `patina-cli` / `patina-humanizer` with release workflow. Issue: [#203](https://github.com/devswha/patina/issues/203).
2. Ship `devswha/patina-action@v1` for PR-comment scoring after the release/versioning path is stable. Issue: [#204](https://github.com/devswha/patina/issues/204).

### Wave 1 — documentation, governance, and issue hygiene

1. Document the policy for external promotional / third-party-platform solicitation issues. Issue: [#245](https://github.com/devswha/patina/issues/245).
2. Center the README hero block once the social/brand surfaces settle. Issue: [#241](https://github.com/devswha/patina/issues/241).
3. Document Korean translation policy and extend KR pairs for primary docs. Issue: [#202](https://github.com/devswha/patina/issues/202).
4. Tie this roadmap to a GitHub Project board or Milestones. Issue: [#195](https://github.com/devswha/patina/issues/195).
5. Add JSDoc public exports and publish generated API reference. Issue: [#191](https://github.com/devswha/patina/issues/191).
6. Decide priority labels for [#99](https://github.com/devswha/patina/issues/99) and [#104](https://github.com/devswha/patina/issues/104) so the open-issue queue stays sortable.

### Wave 2 — tests and backend hardening

1. Add golden snapshot tests for `buildPrompt` combinations. Issue: [#169](https://github.com/devswha/patina/issues/169).
2. Unify backend timeout / `AbortSignal` / fallback contracts. Issue: [#131](https://github.com/devswha/patina/issues/131).
3. Add SIGINT cancellation for in-flight backends and HTTP calls. Issue: [#133](https://github.com/devswha/patina/issues/133).
4. Introduce a leveled structured logger to replace ad-hoc `console.error`. Issue: [#132](https://github.com/devswha/patina/issues/132).
5. Add progress indicators for `--models` and `--ouroboros`. Issue: [#180](https://github.com/devswha/patina/issues/180).

### Wave 3 — scoring and stylometry quality

1. Add zh/ja char-n-gram fallback for stylometry. Issue: [#151](https://github.com/devswha/patina/issues/151).
2. Add deterministic feature signals as a shadow score and tie-breaker. Issue: [#136](https://github.com/devswha/patina/issues/136).
3. Record scores, tokens, response hashes, seeds, and iteration logs in manifest schema v2. Issue: [#134](https://github.com/devswha/patina/issues/134).
4. Add a persistent prompt-response cache keyed by prompt hash, model, and temperature. Issue: [#135](https://github.com/devswha/patina/issues/135).
5. Add voice-anchor few-shot scoring from user-supplied human references. Issue: [#137](https://github.com/devswha/patina/issues/137).

### Wave 4 — patterns and profiles

1. Add zh/ja per-pattern Semantic Risk / Preservation Note annotations. Issue: [#147](https://github.com/devswha/patina/issues/147).
2. Backport pattern #32 "comparison adverb overuse" to en/zh. Issue: [#148](https://github.com/devswha/patina/issues/148).
3. Add zh/ja pattern overrides to blog, casual-conversation, formal, instructional, and narrative profiles. Issue: [#149](https://github.com/devswha/patina/issues/149).
4. Quantify overlap between style/language/filler packs. Issue: [#152](https://github.com/devswha/patina/issues/152).
5. Add genre-specific packs for code comments, commit messages, and release notes. Issue: [#153](https://github.com/devswha/patina/issues/153).
6. Expand viral-hook patterns from 5 to 8–10 per language. Issue: [#154](https://github.com/devswha/patina/issues/154).

### Wave 5 — research and parked expansion

Keep these out of the critical path until npm packaging, release support, and the core quality loop are stable:

- Editor / platform integrations: VS Code, Obsidian, static-site generators, web playground. Issues: [#206](https://github.com/devswha/patina/issues/206), [#207](https://github.com/devswha/patina/issues/207), [#208](https://github.com/devswha/patina/issues/208), [#210](https://github.com/devswha/patina/issues/210).
- Ecosystem packaging: Docker image, pattern marketplace, HuggingFace corpus. Issues: [#209](https://github.com/devswha/patina/issues/209), [#211](https://github.com/devswha/patina/issues/211), [#212](https://github.com/devswha/patina/issues/212).
- Larger research tracks: 2025+ re-baseline, lexicon freshness, quarterly pattern review, blinded human evaluation, cross-judge agreement, adversarial MPS audit, and detector-comparison expansion. Issues: [#155](https://github.com/devswha/patina/issues/155), [#160](https://github.com/devswha/patina/issues/160), [#165](https://github.com/devswha/patina/issues/165), [#156](https://github.com/devswha/patina/issues/156), [#158](https://github.com/devswha/patina/issues/158), [#159](https://github.com/devswha/patina/issues/159), [#163](https://github.com/devswha/patina/issues/163).
