# Changelog

All notable changes to patina. Dates are release dates (YYYY-MM-DD).

## Release entry template

```md
## X.Y.Z — YYYY-MM-DD

**Short release title.**

Semver rationale: patch | minor | major — explain whether this changes patterns, schemas, CLI behavior, or docs only.
```

## 5.3.0 — 2026-06-15

**Harness & conventions: a reproducible per-signal impact (ablation) tool and a documented workflow for adding deterministic detection signals.**

Semver rationale: minor — adds a contributor-facing benchmark tool and workflow docs. No CLI, schema, pattern, or detection-behavior change; all four languages are byte-identical.

### Added
- `scripts/signal-impact.mjs` (`npm run benchmark:signal-impact`): joins a labeled manifest (`expected_hot`) to its local text, runs `analyzeText()` once per row, and recomputes the hot verdict with each signal ablated to report each signal's **marginal** catch/FP contribution (attributable TP/FP) plus Δrecall/Δfpr/ΔF1. Deterministic and gitignore-safe (reads local/private corpus, emits aggregate metrics only). Replaces the ad-hoc eval-kernel measurement used to calibrate the 5.2.0 KO signal.
- `docs/HARNESS.md`: an index of every measurement, calibration, and gate tool (deterministic vs LLM, command, docs link), linked from `README*` and `tests/quality/README.md`.
- `CONTRIBUTING.md` / `CONTRIBUTING_KR.md` "Adding a Deterministic Detection Signal": codifies the calibration loop (diagnose → FP-safe discriminator → first-class implementation → mirror every surface → measure with the harness → version), the advisory-vs-hot-signal rule, the FP tolerance bar, and the surfaces to keep in sync.

## 5.2.0 — 2026-06-15

**Korean detection: a deterministic "uniform plain-다 register" hot signal that catches short, length-uniform AI Korean the burstiness gate skipped.**

Semver rationale: minor — adds one KO-only deterministic stylometry signal to the per-paragraph hot rule. No removals; en/zh/ja behavior is byte-identical; false positives stay within the published tolerance.

### Changed
- New per-paragraph hot signal for Korean (`src/features/stylometry.js#koreanEndingMonotony`, wired in `src/features/index.js` and mirrored in `playground/analyzer.js`): a paragraph is hot when declarative `-다` endings dominate (ratio ≥ 0.6 and count ≥ 2) **and** sentence lengths are uniform (burstiness CV below the low band) **and** the paragraph has ≥ 20 tokens. Unlike the standard burstiness trigger it does not require 3 sentences, so it catches short AI Korean the band gate skipped, while the `-다` + low-CV conjuncts spare formal human Korean (same `-다`, varied sentence lengths → high CV) and conversational Korean (요/습니다), and the 20-token floor spares terse snippets.
- Measured on the KO rebaseline manifest (n=380, deterministic analyzer): **KO×GPT catch 45.0% → 82.5%**, KO recall 59.2% → 70.8%, accuracy 77.6% → 80.8%, F1 0.644 → 0.716, precision 70.6% → 72.4%; human-control FPR 12.8% → 14.0% (within the published 11.6–21.7% CI). EN is unchanged. The frozen public claim manifests and the headline catch/FP claim are refreshed on the next dedicated rebaseline pass, not by this change.

## 5.1.0 — 2026-06-14

**Adds Claude Code plugin-marketplace distribution, an optional multi-agent `--strict` skill mode, and Korean translationese academic grounding.**

Semver rationale: minor — additive only. No CLI or schema removals, the deterministic engine is unchanged, and all new behavior is opt-in (default-off), so existing runs are byte-identical without the new flags.

### Added
- Claude Code plugin marketplace: `/plugin marketplace add devswha/patina` then `/plugin install patina@patina`. The repo-root `SKILL.md` auto-loads as the `/patina` skill (no `skills/` directory or `skills` manifest field), so the pattern/core/lexicon data directories stay untouched. `uninstall.sh` mirrors the script install for clean removal.
- Three read-only subagents auto-discovered from `agents/`: `patina-detector` (stylometry + AI-lexicon + pattern findings), `patina-fidelity-auditor` (MPS/fidelity audit), and `patina-naturalness-reviewer` (residual-tell + over-edit grade).
- Opt-in `--strict` multi-pass skill mode in `SKILL.md`: detect → rewrite → fidelity/MPS audit → naturalness re-scan → accept/retry/rollback. In a plugin environment `--strict` delegates the read-only analysis passes to the subagents via the `Task` tool; otherwise it runs the same passes inline in a single agent, with identical floors and gate logic.
- `docs/research/ko-translationese-scholarship.md` anchoring patina's Korean detectors to verifiable sources (Gellerstam 1986, Baker 1993, Toury 1995, Toral 2019; Korean 번역투 tradition: 이근희 2005/2008, 김순영 2012), with an honest scope note (concept/terminology grounding, advisory-only). `epoko77-ai/im-not-ai` added to `docs/COMPARISON.md`. Non-technical Korean onboarding added to `README_KR.md`.

### Fixed
- Synced previously-stale version surfaces that had drifted behind `package.json`: the `docs/ROADMAP.md` repo-metadata note and the `README_KR`/`README_ZH`/`README_JA` version badges.

## 5.0.0 — 2026-06-14

**Breaking: `--preview` is URL/`.html`-only and the deprecated `--browser` alias is removed; adds `--restyle`/`--jargon` transformations, `--preview` variant comparison, and a word-level diff view.**

Semver rationale: major — removes two shipped CLI surfaces. `--browser` (deprecated since 4.x) no longer exists; use `--preview`. `--preview` no longer accepts `.md`/`.markdown`/`.txt` "reading document" input — it now takes only an http(s) URL or a local `.html`/`.htm` file, both of which run through the snapshot pipeline that renders the page and overlays rewrites in place. Markdown/text drafts rewrite with `patina <file>` or inspect with `patina --diff <file>`. The release also adds opt-in `--restyle`/`--jargon` transformations and `--tone` lists, `--preview` variant comparison, and a word-level diff view — all default-off, so prompts stay byte-identical without the flags.

### Removed
- `--browser` CLI flag (deprecated alias for `--preview`): the deprecation warning and alias mapping are gone, and the flag is rejected as unknown.
- `--preview` markdown/plain-text reading-document mode (`.md`/`.markdown`/`.txt`), which rendered raw markup as escaped text and could corrupt inline markdown markers. `--preview` input is now restricted to http(s) URLs and local `.html`/`.htm` files. `buildFilePreviewHtml` and its standalone reading-document stylesheet (`FILE_PAGE_CSS`) were dropped from `src/preview.js`.

### Added
- `--restyle <sentence|voice|content>` and `--jargon <keep|explain|remove>`: opt-in transformations beyond AI-pattern cleanup, on the default rewrite and `--preview`. `voice` rewrites the whole text in the target voice/register; `content` re-plans at the content level (Meaning-Preservation Score reported as advisory); `explain`/`remove` control technical-term handling for non-technical audiences. Defaults change nothing, and combining an active transform with `--score`/`--audit`/`--diff`/`--ouroboros` is an input error.
- `--preview` variant comparison: comma-separated `--restyle`/`--jargon`/`--tone` values run one rewrite call per combination (capped at 4) and bake every variant into the preview behind a scriptless two-level toggle — a primary button per restyle depth and a per-depth option chip row for tone/jargon — each variant carrying its own deterministic score. stdout carries the first variant; the explanation call is skipped in compare mode. Requires a URL/`.html` snapshot and is incompatible with `--ocr`.
- `--preview` word-level **diff view**: a fourth view toggle (rewritten / original / both / diff) renders each changed block as one merged stream — common words plain, removed words struck, added words highlighted — computed deterministically at page-build time (LCS over whitespace tokens, capped with a whole-text fallback).
- `--preview` URL extraction now skips navigation chrome (`aside`, `role`-marked navigation, and sidebar/TOC/breadcrumb id/class tokens — covers app-shell/Fumadocs layouts) and leaves blocks carrying inline `code`/`kbd`/`var` untouched; model-added markdown backticks are stripped before the in-place snapshot swap.

## 4.3.0 — 2026-06-13

**Reliability, security, and false-positive hardening from the 2026-06-13 full-repo architect review.**

Semver rationale: minor — adds the `--no-stop-on-retryable-storm` batch flag and `--name=value` / `--` argument syntax, and changes several user-observable CLI behaviors (config/voice-sample input errors now exit 2; retryable-storm stopping is restricted to EX_TEMPFAIL/timeout; per-attempt timeouts surface as `TimeoutError`; the ouroboros loop drops its per-iteration self-audit; document input is data-fenced in prompts). The rest is security, correctness, and false-positive bug fixes across the deterministic engine, the LLM/backend layers, preview, and the playground. No API or schema removals.

### Security
- Refuse token-leaking plaintext HTTP: `isLoopbackHost` exempts only real IPv4 loopback literals, so `http://127.attacker.example/` is no longer treated as loopback and the Bearer token is not sent in cleartext to a non-loopback host (#448).
- `--preview --ocr` confines local `file:` image candidates to the previewed file's own directory subtree, so a malicious local `.html` can no longer reference an absolute path (e.g. `file:///home/you/passport.jpg`) and exfiltrate it to the OCR backend (#447).
- Preview injection hardening: page/LLM/OCR-derived text placed in `String.replace` replacement positions is applied via function replacements, so a literal `$`-sequence can no longer expand to the document prefix and duplicate the page; the fetched page body is read under a true streaming byte cap instead of being fully buffered; document input is wrapped in a sentinel data-fence so adversarial third-party text under `--batch`/`--gate`/ouroboros cannot pose as the prompt's own `## Output`/`[BODY]`/`[SELF_AUDIT]` sections (#447, #444).
- Every page-fetch redirect hop is SSRF-guarded against private/internal targets (#439).

### Fixed — detection accuracy & false positives
- CJK sentence splitting keeps terminators inside closing quotes attached and no longer strands zero-token "sentences"; `…` is no longer a hard terminator in en/ko; AI-lexicon strict entries match on whole-word boundaries and phrases match across soft line wraps (#441).
- `navlist` only counts as model-output leakage with a corroborating tool token; CommonMark setext H2 underlines and YAML frontmatter no longer count as decorative dividers; the `당신` direct-address rule gains Hangul boundary guards; `c11-connective-comma` excludes common 고-final nouns (#442).
- Self-identification leakage no longer false-positives on human bio/ML prose (#435).
- Structural classifier: corrupt/non-object model files fail loud, zero/negative sigma is rejected, the max-FPR threshold uses `ceil`, the audit path degrades to a warning, and a model trained at the wrong feature width is rejected at load (#443, #436).

### Fixed — reliability
- LLM client / ouroboros: a per-attempt timeout that exhausts retries surfaces as `TimeoutError` (not `AbortError`), so `scoreMPS`/`scoreFidelity` take the fail-closed rollback instead of crashing the run; a throw from the `onResponse` callback no longer re-issues the already-paid request; the loop fails closed on a missing fidelity and stops paying for a self-audit block it immediately strips; fidelity/MPS floors are checked before declaring the target met (#444, #437).
- Backends: an explicit `status: null` no longer skips retry detection; the concurrency cap fails closed on an invalid override; a crashed run's slot is reclaimed by pid-liveness instead of blocking a cap-1 backend for ~30 min, and slot roots are per-user; a flag-sourced foreign-family model is dropped per fallback leg; codex stdout is discarded to avoid a pipe-buffer deadlock (#445, #438).
- CLI adapters: codex stderr decodes as UTF-8; image-staging failures clean up the temp dir and surface a typed error; a stdin error kills the child before its cwd is removed; signal death is reported instead of "exited with code null"; gemini/kimi banner stripping is tightened to avoid eating real response lines (#446).
- CLI: output-routing flags (`--in-place`/`--suffix`/`--outdir`) are batch-only and mutually exclusive with `--outdir` collision detection; blank numeric option values are rejected instead of coercing to 0; the interactive stdin prompt writes to stderr so it shows under `--quiet`; Ctrl-C during batch is a run-level stop, not a per-file failure; explicit `--max-failure-rate` keeps its warm-up sample (#440, #434).
- Infra: config/tone/voice-sample input validation throws typed errors (exit 2); `--diff --format json` no longer embeds ANSI escape codes; the logger honors an injected stream; `getExitCode` rejects exit 0 on a thrown error; hosted-response span offsets validate against the returned text length (#449, #445).
- Playground: text-presentation symbols (™/©/®) no longer count as emoji; lexicon highlighting falls back to plain escaping when case folding changes string length; per-keystroke re-analysis is debounced (#450).

### Added
- `--no-stop-on-retryable-storm` to opt out of batch retryable-storm stopping (on by default in batch mode); `--name=value` argument syntax and a `--` end-of-options separator so dash-prefixed file names are usable (#440).

## 4.2.0 — 2026-06-12

**In-place preview as the single review surface: file input, image-text OCR, full-page extraction coverage, live-design fidelity, and context-aware rewriting.**

Semver rationale: minor — adds `--preview` file input, `--ocr`, the document-brief rewrite stage, and the extractor coverage rewrite; deprecates `--browser` behind a working alias (its stdout `--format` passthrough and any-extension input change under the deprecated flag, documented below rather than treated as breaking); the rest is preview-fidelity and sanitizer bug fixes. No API or schema removals.

### Added
- `--preview` accepts local files, not just URLs (#423): `.html`/`.htm` runs through the same snapshot pipeline as a fetched page; `.md`/`.markdown`/`.txt` renders as a reading document. Both flows gain the diff page's remaining advantages — a collapsible "patina notes" explanation panel, a deterministic before/after score chip, and a three-state view toggle (rewritten / original / both, CSS-only). When the model merges or splits paragraphs, alignment falls back to LCS anchoring plus order-monotonic bigram-similarity pairing; unmatched blocks keep their original text instead of failing the run.
- `--ocr` (#424): with `--preview` on URL/`.html` input, text baked into page images (card-news, banners, thumbnails) joins detection. Image-capable local CLI backends (`claude-cli`/`gemini-cli`/`codex-cli`) act as the vision layer — zero new dependencies, images staged into the backends' isolated temp dirs, the whole timeout/abort/fallback stack applies. Pixels can't be edited, so changed findings render as annotation cards embedding the exact OCR'd image, its text, and the suggested rewrite. Caps: 8 images/page by priority, 6MB/image (streamed), 16MB total; `file:` images only for local previews (SSRF guard).
- URL extractor rewrite (#425): `extractProseBlocks` is now an attribute-aware single-pass tokenizer that recovers prose nested in rejected containers (`li>p`, wrapper divs), handles HTML5 optional end tags and React SSR empty-comment separators, and extracts leaf `div`/`section`/`article` copy. Measured visible-text coverage on real pages went from 16–55% to 73–84%.
- Document-brief rewrite stage: rewrite prompts (minimal and strict, plus the SKILL.md pipeline as step 4.8) now derive a whole-document frame — document type, speaker/audience, dominant register, domain terms — before editing, and unify all rewritten sentences to the document's dominant register. For Korean input the dominant register is measured deterministically (`detectKoreanRegister`, sentence-ending distribution) and injected as a "document signals" section; `--preview` shows the measurement in a *document context* notes card. Addresses rewrites that stayed AI-flavored because blocks were paraphrased without global context.

### Fixed
- `--preview` snapshot sanitizer is now a tag-aware walk (#425): neutralizes unclosed `<script>`, handlers hidden behind a `>` inside a quoted attribute, `/`- and quote-separated handler chains, and entity/control-encoded `javascript:` URLs; the page also carries a restrictive CSP (scripts/frames/objects blocked, passive assets allowed). `--ocr` image fetches from page content are SSRF-guarded — private/loopback/metadata addresses (including IPv4-mapped IPv6) refused unless same-host as the page, re-checked per redirect hop.
- `--preview`: inlined `<iframe srcdoc>` detail content is no longer clipped by the host page's fixed-height `overflow:hidden` iframe wrapper — the adjacent sizing wrappers' inline height/overflow declarations are neutralized when the detail is inlined (#427).
- `--preview`: inlined `<iframe srcdoc>` content now renders its viewport-relative CSS against the old iframe box instead of the window — the wrapper is a CSS container (`container-type:inline-size`) and the srcdoc's `vw` units and width-based `@media` queries are rewritten to container units/queries at inline time, so typography sizes and breakpoint layouts match the live page exactly (#430).
- `--preview`: snapshots now freeze same-origin assets — stylesheets are inlined (relative `url()` absolutized against the stylesheet URL) and their same-origin fonts embedded as `data:` URIs — so pages render with their real CSS and web fonts even when the site blocks cross-site asset loads via Fetch Metadata, as Vercel-hosted sites do (#428).

### Deprecated
- `--browser` is now an alias for `--preview` and prints a deprecation notice on stderr; the flag will be removed in 5.0. The in-place preview covers the old side-by-side diff page (the "both" view shows the rewrite next to the struck-through original) plus URL input, the score chip, and the notes panel. Behavior changes under the alias: stdout carries the rewritten prose only (the old byte-for-byte `--format` passthrough on stdout is gone), and input must match the preview contract (`.html`/`.md`/`.markdown`/`.txt`). The separate diff-page renderer was removed; `--serve` now documents against `--preview` (#426).

## 4.1.0 — 2026-06-11

**Browser diff page, Korean post-editese advisory analyzer, and detector calibration fixes.**

Semver rationale: minor — adds the `--browser` rewrite diff page, the Korean post-editese advisory analyzer surfaced through `analyzeText`, and an optional structural-classifier scoring hook; the rest is bug fixes to Korean detection rules, local-CLI backends, score-prompt reliability, and npm packaging. Note: 4.0.1 was tagged in this file but never published, so npm consumers upgrade straight from 4.0.0 and pick up its `patina-cli` bin alias here.

### Added
- `--browser` rewrite add-on: rewrites one local file (stdout stays byte-for-byte identical for the selected `--format`), then writes a self-contained local HTML before/after diff page — side-by-side text, changed-block highlights, deterministic score summaries, and a best-effort diff-explanation backend call (one extra model call; explanation failure never fails the rewrite). Rejects stdin/`--batch`/URLs/non-rewrite modes; if the browser cannot be opened, the saved HTML path is printed on stderr.
- Korean post-editese advisory analyzer (`koPostEditese.v1`): deterministic descriptive metrics (lexical, endings, interference, rhythm) surfaced through `analyzeText` as advisory-only metadata — never folded into the hot verdict or the score.
- Optional structural-classifier scoring hook: config `stylometry.structural_model.path` (or the `PATINA_STRUCTURAL_MODEL` env var) can point at a local structural model; when a loaded model marks text hot, the deterministic score gets a 70-point floor and a `structuralClassifier` band (`available`/`hot`/`score`/`floor`) appears in the deterministic-score JSON. Without a model, behavior is unchanged.

### Fixed
- Korean `koPostEditese` no longer misclassifies regular formal `-ㅂ니다 / -ㅂ니까` endings (됩니다, 표시됩니다, 합니까…) as declarative `-다` style, so clean 합쇼체 prose is no longer pushed toward register-changing rewrites.
- Translationese `a16-pronoun-literal` no longer fires on ordinary nouns ending in `그` (로그/버그/태그) or on 그녀석/그것참; it now requires eojeol boundaries on both sides.
- Translationese `t2-by-passive` now matches the common fused passive forms (된다/됩니다/될/진다) that the previous jamo alternation silently missed.
- Deterministic audit backstop now respects each rule's `minCount` (e.g. `c11-connective-comma` no longer surfaces on a single match).
- Local-CLI backends (claude/gemini/kimi) decode stdout as streaming UTF-8, fixing silent corruption of multi-byte CJK output split across pipe reads; all four backends now handle stdin EPIPE instead of crashing the process when a child exits before draining a large prompt.
- Ouroboros loop strips `[BODY]/[SELF_AUDIT]` tags before scoring and re-feeding, returns the best-scoring text paired with its score, and treats a failed MPS scorer as a floor violation (fail closed, matching fidelity).
- Rewrite tone-footer removal anchors to the final `---` block, so a markdown thematic break in the body no longer truncates everything after it.
- `--config <file>` now wins over an ambient `./.patina.yaml` / `~/.patina.yaml` (reproducible runs); config merge is guarded against prototype pollution.
- Mutually exclusive output modes (`--diff` / `--audit` / `--score` / `--ouroboros`) are now rejected up front instead of silently resolving to one mode (which could make a `--score` CI gate always exit 0).
- Discourse tells (fake-candor openers / thematic breaks) are now attributed to the paragraphs that carry them (#391), so flagged paragraphs enter rewrite scope and reach the deterministic score through the hot ratio — matching the playground. The interim document-level 35-point score floor (added and removed within this release; never published) is gone; the ≥2/≥3 density gates are unchanged. Discourse-hot paragraphs also carry signal strength (tell count normalized by the density gate), keeping the signal-score ranking leg consistent with the hot verdict (no hot-with-zero-signal rows). Prose gates (`precommit-score`/`dogfood`) keep their hot-prose-ratio semantics: bare `---` divider pseudo-paragraphs are excluded from the gate ratio, while divider spam still reaches the mdx ranking through `flooredScore`.

- npm package now ships the scripts behind the `benchmark:rebaseline:generate-modern`, `benchmark:rebaseline:claim-manifest`, `benchmark:rebaseline:fp-fixtures`, and `qa:mdx` npm scripts (`rebaseline-generate-modern.mjs`, `rebaseline-build-claim-manifest.mjs`, `fp-fixture-export.mjs`, `qa/mdx-score.mjs`), which previously failed with MODULE_NOT_FOUND for npm consumers (#411).

### Changed
- `--format text` output no longer appends the `Tone: <tone> (<source>)` trailer line.
- `--score`/`scoreText` prompts now embed per-pack pattern counts and a full catalog digest, and `scoreText` follows a single strict-JSON output contract (with strip options and a `flooredScore` field); the `patina-score` prose gate strips paired emphasis markers only (so URL-leakage signals like `utm_source=chatgpt.com` survive) and scores through `scoreText` with the lexicon channel and canonical floors — gate scores can shift slightly vs 4.0.0.
- `kimi-cli` backend runs with `--max-steps-per-turn 20` (up from 1). It stays in non-interactive `--print` mode with no `--yolo`, so the agent cannot auto-approve shell/file tools — the extra steps only cover reasoning/formatting within a turn (verified that injected tool-use instructions in user text do not execute).
- Internal: `src/cli.js` decomposed into per-concern modules (`src/cli/args.js`, `batch.js`, `input.js`, `score-gate.js`, `run.js` — #409, #413, #414), and the generated `docs/API.md` no longer claims boilerplate `@throws` on functions that cannot throw.

## 4.0.1 — 2026-06-07

**Fix npx package-name execution.**

Semver rationale: patch — adds a bin alias so documented `npx patina-cli ...` commands resolve to the CLI entrypoint.

### Fixed
- Added the `patina-cli` binary alias alongside `patina`, so `npx patina-cli doctor` works without requiring `npx -p patina-cli patina ...`.

## 4.0.0 — 2026-06-04

**Surface reset for a smaller, zero-config patina.**

Semver rationale: major — removes public CLI commands, flags, and backend surfaces that shipped before the npm 4.x line; users relying on those names must move to the remaining explicit CLI/API surfaces.

### Added

- **Private-asset leak gate** (`scripts/check-no-private-assets.mjs`, `npm run check:no-private-assets`): enumerates `npm pack --dry-run --json` for both `patina-cli` and `packages/patina-humanizer` plus tracked files, and fails if forbidden private-asset paths appear. Wired into `prepublishOnly` and CI.
- Centralized backend default-model metadata and surfaced it in `--list-backends`: OpenAI/Codex default to `gpt-5.5`, Claude to `claude-sonnet-4-6`, and Gemini to `gemini-2.5-pro`.

### Changed

- Reworked the README into a shorter landing page focused on demo, quick start, common commands, CI, and core docs.
- Expanded `--list-backends` from a name-only listing into backend diagnostics with kind, selector hints, default models, auth status, and setup notes.
- Kept provider presets on the HTTP backend path so `--provider gemini` uses the Gemini HTTP API instead of being misrouted by local-CLI model heuristics.

### Removed

- Removed the opt-in `patina-hosted` backend, hosted schema, and ko hosted-compare harness; the public CLI now keeps local CLI and OpenAI-compatible HTTP backends only.
- Removed standalone MAX mode (`/patina-max`, `--models`, `--max-concurrency`, `--max-timeout`) and its composite scorer.
- Removed `--variants`, `--save-run`, response cache flags, `--suspected-generator`, user-facing `--prompt-mode`, the `--gate` alias, main CLI `--json` alias, `--json-logs`, and `--list-providers`.
- Removed share-card SVG output (`--card`), the one-time star nudge, and deprecated inline `--api-key`; use `--api-key-file` or environment variables for HTTP auth.
- Removed `patina init`; patina remains zero-config, with optional manual `.patina.yaml` only when project defaults are needed.

## 3.12.0 — 2026-06-02

Semver rationale: minor — adds new deterministic detection signals plus two new pattern-pack detections across ko/en/zh/ja; backward compatible.

### Added

- **Model-output leakage detection** (#332): a deterministic detector for pasted-LLM artifacts that never appear in human prose — OpenAI citation markup (`:contentReference` / `oaicite` / `oai_citation`), model tool tokens (`turn0search1`, `navlist`, `grok_card`), the U+FFFC object-replacement char, AI-tool tracking params (`utm_source=chatgpt.com`, …), and explicit self-identification (`as an AI language model`, …). A single hit is near-proof-grade, so it forces the document hot and now short-circuits the deterministic and playground score into the 'heavily AI' band (floor 90). New `src/features/markup-leakage.js`, mirrored in the playground.
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
