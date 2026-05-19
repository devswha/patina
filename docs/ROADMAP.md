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
  - Korean AI catch: 91%
  - English AI catch: 76%
  - human false positives: 13-25%
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

Recommended order:

1. Link research notes and roadmap from README.
2. Add GitHub issue/PR templates and community docs.
3. Add benchmark report generation.
4. Add a Patina logo/icon and social preview image. **Done:** source SVGs live in `assets/brand/` and `assets/social/patina-og.svg`.
5. Add a terminal demo asset.
6. Prepare one focused launch post.
7. Publish npm only after install/support policy is settled.
