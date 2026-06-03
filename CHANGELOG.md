# Changelog

All notable changes to patina. Dates are release dates (YYYY-MM-DD).

## Release entry template

```md
## X.Y.Z — YYYY-MM-DD

**Short release title.**

Semver rationale: patch | minor | major — explain whether this changes patterns, schemas, CLI behavior, or docs only.
```

## Unreleased

## 3.12.0 — 2026-06-02

Semver rationale: minor — adds new deterministic detection signals plus two new pattern-pack detections across ko/en/zh/ja; backward compatible.

### Added

- **Model-output leakage detection** (#332): a deterministic detector for pasted-LLM artifacts that never appear in human prose — OpenAI citation markup (`:contentReference` / `oaicite` / `oai_citation`), model tool tokens (`turn0search1`, `navlist`, `grok_card`), the U+FFFC object-replacement char, AI-tool tracking params (`utm_source=chatgpt.com`, …), and explicit self-identification (`as an AI language model`, …). A single hit is near-proof-grade, so it forces the document hot. New `src/features/markup-leakage.js`, mirrored in the playground.
- **Em-dash and boldface overuse in the playground** (#333, partial): the browser analyzer now counts document-level em-dash (≥3) and markdown bold (≥5) overuse, mirroring catalog patterns #13/#14. Emoji / title-case / inline-header remain tracked in #333.
- **Density-gated discourse tells** (#334): fake-candor / manufactured-intimacy openers (`here's the thing`, `the truth is`, …) fire at ≥2 per document; decorative thematic breaks (`---` / `***` / `___`) fire at ≥3. New `src/features/discourse-tells.js`; fake-candor mirrored in the playground.
- Added language-pack pattern #33 **Definitional-Metaphor Equation ("X is the Y of Z")** (ko/en/zh/ja) — flags copula sentences that assert a grand abstract equivalence ("Cringe is the visible signature of …") to manufacture profundity; disambiguated from #8 Copula Avoidance.
- Added viral-hook pattern #9 **Aphoristic Punchline (Standalone Declarative)** (score-only, ko/en/zh/ja) — flags short pseudo-profound declaratives given their own line for gravitas ("Symmetry becomes a trap.").
- Externally sourced from "LLM smells" observations; updated `core/scoring.md` category counts (language 7→8, viral-hook 8→9, total 40→42) and `docs/PATTERNS-*.md` references to match.

### Changed

- Trimmed the npm tarball from ~10MB to 627KB by excluding non-runtime assets.
- Reworked the README hero to be text-first and demoted the demo GIF below the static example; added per-language README demos.
- Added a typewriter terminal animation for the README demo GIF.
- Added a maintainer-owned launch-execution handoff packet (`docs/social/patina-launch-execution.md`).
- One-click false-positive report button on the playground (#331).

### Evidence

- Refreshed modern-model and English/Korean lexicon-lift benchmark evidence; widened Korean false-positive register coverage with positive-side calibration.
- Aligned the issue-wave map and backlog docs with live GitHub state.

## 3.11.0 — 2026-05-20

**Launch-readiness polish for trust, benchmarks, and distribution.**

Semver rationale: minor — adds CI/release/distribution surfaces and documentation, while preserving the core rewrite pipeline and existing CLI behavior.

### New

- Prepared npm release metadata for `patina-cli` plus the `patina-humanizer` alias package.
- Added a release workflow for npm provenance publishing and GHCR image publishing.
- Added deterministic GitHub Action and pre-commit scoring surfaces for Markdown review.
- Added Dockerfile-based container runtime for API-backed CLI use.

### Quality

- Added release metadata checks so package/config/skill/changelog versions stay synchronized.
- Added deterministic prose-score tests and pre-commit E2E coverage.
- Expanded the deterministic suspect-zone benchmark to ko/en/zh/ja with checked-in per-fixture metric ranges.
- Added an offline detector-comparison harness and 2025+ re-baseline plan for future benchmark evidence.

## 3.10.0 — 2026-05-06

**Tone categorization v1 (6 tones + `auto`).**

A first-class `tone` axis sits on top of profiles, giving users an explicit
voice category without having to memorize the profile catalog. Tone resolution
is `--tone` CLI > `tone:` config > `profile:` config; absence of any tone keeps
v3.9.0 behavior intact (regression-safe profile-only path).

### New

- **`--tone <name>` flag and `tone:` config field.** Six v1 tones plus `auto`:
  `casual`, `professional`, `academic`, `narrative`, `marketing`,
  `instructional`. Unknown values fail fast with the valid list.
- **Two new profile backbones:** `profiles/narrative.md` and
  `profiles/instructional.md` (ko + en sections each). zh/ja sections are
  intentionally omitted for v1.
- **Phase 4.5b heuristic auto-detection.** When `--tone auto`, deterministic
  lexical and structural signals select a single tone with `tone_evidence`
  (1–3 strings) and `tone_confidence` (`low`/`medium`/`high`). No fallback on
  low confidence — always commits to a single tone (A5).
- **Phase 5b tone override layer.** Resolved tone applies a per-tone override
  pack on top of profile overrides. **Tone overrides replace profile overrides
  on conflict; they do not stack** (idempotent application).
- **Phase 6 YAML footer.** Every output mode (`rewrite`, `diff`, `audit`,
  `score`) emits a trailing footer block:
  ```
  ---
  tone: <resolved | null>
  tone_source: user | auto | unsupported_language_fallback | profile_only | skipped_short_input
  tone_evidence: [...]
  tone_confidence: low | medium | high | null
  ---
  ```
  Body text in `rewrite` mode contains zero tone metadata leakage.
- **12 fixture pairs** under `examples/tones/` (6 tones × ko/en) showing the
  documented behavioral direction per tone.

### Behavior

- **zh/ja with any `--tone` (including `auto`)** emits a warning to stderr
  and the YAML footer (`tone_source: unsupported_language_fallback`), then
  continues in profile-only mode. Phase 4.5b heuristics only cover ko/en
  signals, so `auto` on zh/ja would silently degrade to residual
  `professional` without useful evidence — the fallback is intentional.
- **legal/medical fidelity preserved within `professional` tone.** When the
  active profile is `legal` or `medical`, `combined-weights.{legal|medical}`
  (fidelity 0.65) is forced regardless of tone resolution. Tone overrides
  cannot lower the fidelity floor (R2).
- **Short-input bypass.** Texts with `<2 paragraphs OR <2 sentences` skip
  Phase 4.5b detection entirely and emit `tone_source: skipped_short_input`
  with `tone_evidence: ["input too short"]`. This is distinct from the
  residual-default path (auto detection ran but no signal cluster reached
  threshold), which keeps `tone_source: auto`.

### Quality

- **`hasToneFooter()` validates all 4 keys.** Detection now requires `tone`,
  `tone_source`, `tone_evidence`, and `tone_confidence` to be present in the
  fenced block. Partial model-emitted footers no longer suppress the CLI
  authoritative footer.
- **`resolveTone()` validates `cliTone` input.** Both CLI and config tone
  values are now validated against the allowed tone list, ensuring fail-fast
  behavior regardless of caller.
- **17 tone unit tests** covering `resolveTone()` priority chain, edge cases
  (empty config, zh/ja fallback, invalid values), backbone profile mapping,
  and `formatOutput` footer emission/deduplication.

### CLI wiring (standalone Node CLI)

The standalone `src/cli.js` CLI threads `--tone` through `src/config.js`
(`resolveTone()`), `src/loader.js` (`toneToBackboneProfile()`),
`src/prompt-builder.js` (tone context block), and `src/output.js`
(YAML footer emission for all 4 modes). `--tone bogus` fails fast with the
valid list. CLI > config > unset priority is preserved. Profile-only
invocations (`patina --profile blog input.md`, no `--tone` and no `tone:`
config) behave identically to v3.9.0 except for the appended YAML footer.

## 3.9.0 — 2026-05-05

**Standalone CLI security hardening (issues #88, #89, #90).**

Three boundary-validation fixes for the standalone `patina` CLI. None of them
affect the `/patina` skill flow inside Claude Code / Codex CLI / Cursor /
OpenCode (the skill runs prompts, not the Node CLI), but anyone running
`patina` from a shell — especially against untrusted input text — should
upgrade.

### Breaking change

- **codex-cli auto-fallback removed.** Previously, when no API key was set
  and `codex` was installed and authenticated, patina silently used the
  codex-cli backend. This sent the user's input to a coding agent, where
  prompt injection in the document body could ask the agent to inspect or
  modify files. The auto-fallback is now removed; codex-cli requires
  explicit `--backend codex-cli` (or `--model codex…`). The error message
  when no API key is found suggests this opt-in.

### Hardening

- **Profile name validation** (`src/security.js`, `src/loader.js`). `--profile`
  values and the `profile:` field in `.patina.yaml` must now match
  `/^[A-Za-z0-9_][A-Za-z0-9_-]*$/`. This blocks `../../README` and similar
  path-traversal reads that would have leaked unrelated `.md` files into the
  LLM prompt.
- **Base URL validation** (`src/api.js`, `src/security.js`). Plaintext
  `http://` is rejected for non-loopback hosts by default. Loopback (`127.*`,
  `localhost`, `::1`) is still allowed for tests and local mocks. Override
  with `--allow-insecure-base-url` or `PATINA_ALLOW_INSECURE_BASE_URL=1` for
  trusted private endpoints. `https://` works as before.
- **Codex sandbox** (`src/backends/codex-cli.js`). When `--backend codex-cli`
  is used, codex now runs with `--sandbox read-only` from a fresh tempdir
  cwd (`-C <tmpdir>`), so a prompt-injected agent cannot reach the caller's
  repo or write outside the temp dir.

### Migration

If you depended on the silent codex-cli auto-fallback, add `--backend
codex-cli` to your invocation, or set `PATINA_API_KEY` / `--provider`. Run
`patina auth status` to see backend availability and how to authenticate.

## 3.8.0 — 2026-05-04

**Korean lexicon re-curation via differential-frequency mining.**

v3.7.0's Korean lexicon was author-curated and contributed only +1pp on AI catch in our paired ko/AI corpus (vs +10pp on English). v3.8.0 mines the corpus for high-signal Korean phrases via differential frequency against NamuWiki human prose, surfacing 12 register markers AI text uses heavily but humans rarely.

Mining rule (`.omc/research/v3_8_ko_lexicon_mine.py`):
- 어절 doc-frequency: AI count ≥ 4 AND ratio AI / (human + 1) ≥ 4.0
- Reject domain artifacts (proper nouns, year-tokens)
- Keep only register markers (passive evaluation, encyclopedic verbs, quantifier scaffolding)

Added entries (`lexicon/ai-ko.md`, 90 → 102 entries):
- Strict (8): `평가된다`, `꼽힌다`, `가리킨다`, `사례로`, `다수의`, `알려져`, `일컬어진다`, `평가받다`
- Phrases (4): `가운데 하나로`, `자리 잡았다`, `알려져 있다`, `~의 사례로`

500-paragraph cross-source result:

| Source | v3.7.0 | v3.8.0 | Δ |
|--------|--------|--------|---|
| HC3 ChatGPT (en) | 76% | 76% | 0pp |
| HC3 human (en) | 19% | 19% | 0pp |
| Wikipedia (en) | 25% | 25% | 0pp |
| NamuWiki (ko) | 13% | 13% | 0pp |
| ko/AI corpus | 83% | **91%** | **+8pp** |

Clean Pareto improvement: AI catch +8pp on Korean with zero false-positive regression. Korean catch rate is now stronger than English (91% vs 76%).

Acceptance gates met: AI recall 91% ≥ 75% · max FP 25% ≤ 25% · ko regression 0pp ≤ +5pp.

## 3.7.0 — 2026-05-04

**AI-lexicon overlap signal (new step 4.7).**

A flat dictionary (`lexicon/ai-en.md` 108 entries, `lexicon/ai-ko.md` 90 entries) flags AI-favored phrases the 28-pattern catalog does not enumerate. Densities are computed per 1000 tokens; the 4.6 hot rule extends to a 3-signal OR (burstiness OR MATTR OR lexicon_density > 2.0).

Calibration (`.omc/research/v3_7_lexicon_eval.py` vs 400 paragraphs):

| Source | v3.5.1 | v3.7.0 | Δ |
|--------|--------|--------|---|
| HC3 ChatGPT (en) | 66% | **76%** | +10pp |
| HC3 human (en) | 12% | 19% | +7pp |
| Wikipedia (en) | 23% | 25% | +2pp |
| NamuWiki (ko) | 11% | 13% | +2pp |

All acceptance gates met (AI ≥ 75%, max FP ≤ 25%, NamuWiki regression ≤ +5pp) — first Pareto improvement over the v3.5.1 wall.

Drop list (post-eval, see `core/stylometry.md` §16): `intersection`, `principles`, `mindset`, `iterative`, `responsible`, `methodologies`, `redefine`, `accessible`, `equitable`, `one of the most`, `in conjunction with`, `the power of` — fired more on academic prose than on AI text.

Skipped v3.6 (n-gram dropped, §15 negative finding).

## 3.5.1 — 2026

**Stylometric calibration patch.**

Raised `stylometry.burstiness.bands.low` from 0.25 to 0.30 after external validation against 300 paragraphs (HC3 ChatGPT 100 + HC3 human 100 + Wikipedia 100). v3.5.0 caught 57% of real AI text; v3.5.1 catches 66% with HC3 human FP 12% and Wikipedia FP 23%.

Sweep showed no threshold combo satisfies both AI ≥ 70% and max FP ≤ 20% — Wikipedia's encyclopedic register naturally has uniform sentence length. MATTR threshold unchanged (0.55). v3.5.x is an advisory marker for the LLM, not a sole-decision gate. Calibration evidence in `core/stylometry.md` §13.

## 3.5.0 — 2026

**Stylometric Suspect Zone Detection.**

New step 4.6 inserted between anchor extraction and the pattern phases. Deterministic burstiness (sentence-length CV) and MATTR (window=50) signals flag suspect paragraphs the 28-pattern catalog misses. Languages: ko + en in v1; zh + ja deferred to v2 roadmap. LLM receives a `<suspect-zones>` meta block plus `«P{n} SUSPECT»` paragraph prefixes as internal working memory. New file: `core/stylometry.md`.

## 3.4.0 — 2026

**Free-tier ergonomics + 4 new patterns.**

- New `codex-cli` backend (no API key — uses local `codex` CLI's ChatGPT OAuth)
- `patina auth status` / `patina auth login` subcommands with auto-fallback when no API key is set
- `--provider` shortcuts for Gemini / Groq / Together AI free tiers
- Pattern additions: #30 (rhetorical question openers) and #31 (conclusion signal words) across all 4 languages, plus #32 (comparative adverb overuse) for KO `보다` and JA `より`
- Default profile expanded to match other profiles' structure
- GitHub Actions CI workflow added

## 3.3.0

**Meaning Preservation System (MPS).** Ensures humanized text maintains original intent and claims. Semantic anchors (claims, polarity, causation, numbers) are extracted before rewriting and verified after each phase.

## 3.2.0

**Ouroboros scoring system.** Pattern-based AI-likeness scoring (0-100), `--score` mode with category breakdown, `--ouroboros` iterative self-improvement loop with configurable termination (target/plateau/regression/max-iterations).

## 3.1.1

**MAX mode reliability fixes.** Per-run temp directory, model-scoped wait loop + timeout handling, Gemini stdin dispatch, Codex CLI compatibility (`--output-last-message`, no `-q`).

## 3.1.0

**MAX mode.** Installable `/patina-max` skill entrypoint + provider-aware dispatch (`claude -p` / `gemini -p` for Claude/Gemini, `codex exec` for Codex).

## 3.0.0

**Multi-language framework.** `--lang` flag, English patterns (24) from blader/humanizer, skill renamed to `patina`.

## 2.2.0

Loanword overuse pattern (#28), badges, repo rename.

## 2.1.0

2-Phase pipeline, structure patterns, blog profile, examples.

## 2.0.0

Plugin architecture: pattern packs, profiles, config.

## 1.0.0

Initial Korean adaptation (24 patterns).
