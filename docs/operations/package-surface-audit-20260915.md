# Package surface audit — 2026-09-15 (PR-07)

Read-only audit of what the npm package surface — the tarballs built
locally through the repository's real packaging path from the audited dev
tree — actually contains, whether shipped assets are reachable, and which of
them could *safely* be excluded later. This document records evidence for a
future maintainer decision; it changes no packaging behavior, removes
nothing, and creates no new obligation.

> This audit measures tarballs built from the recorded audited source tree.
> It does not claim byte identity with the already-published npm 8.7.0
> registry artifacts, whose publication provenance is recorded separately
> (8.7.0 was published from commit
> `6ecd3ce4405f8f6ce5bd84506367a8b61d4b5420`; registry artifacts were not
> downloaded or compared — see §6).

- **Audited tree:** `3c078b11cad206265c19855117a3021a15952d65` (merge of the
  initial audit commit `7da7718…` with `origin/dev`
  `b0a393437b255e199b3fe32e7be181a049c8c050`, PR #846 merged; main ancestry
  verified) in worktree `../patina-maint-07`, branch
  `bot/maint-07-package-surface-audit`. The initial audit ran at
  `67e0cd85f44500c52f0f708ed83bbfad5db33e63`; every measurement below was
  re-run at the refreshed tree because PR #846 changed `docs/WORKFLOW.md`,
  which is part of the shipped `docs/` surface.
- **Environment:** linux x64, Node v24.18.0, npm 11.16.0.
- **Method note:** "no in-repo consumer found" below is never treated as
  "safe to remove". The package has **no `exports` map**, so every shipped
  path remains deep-importable by any external consumer
  ([ARCHITECTURE.md](../ARCHITECTURE.md) documents exactly this for
  `scripts/iterative-rewrite-baseline.mjs`). External usage is therefore
  *plausible/unknown* for every row unless a registry-side measurement says
  otherwise, and none was taken (not authorized here).

## 1. Package surface built from the audited tree (measured)

Locally built candidate tarballs for the current tree — not the
registry-published 8.7.0 artifacts (see the clarification above):

| Package | Files | Packed | Unpacked | Locally built tarball sha256 |
|---|---:|---:|---:|---|
| `patina-cli@8.7.0` (root) | 500 | 1,519,774 B | 5,699,381 B | `bb611a67396f17b1ed939db6205981e485bd7a56c3e857b7a92d0507bd0b6cdb` |
| `patina-humanizer@8.7.0` (alias) | 3 | 628 B | 972 B | `63be3af3f445627fc15cc0f9ee0167a098d07b88bfb811c7077514bb049bd168` |

Both measured through the repository's real packaging path
(`npm pack --dry-run --json` plus `scripts/release-artifacts.mjs`, which packs
each package once, verifies metadata, and clean-install smokes the exact
locally built tarballs — see §5). Nothing was published.

The alias package is minimal by design: `bin/patina-humanizer.js` (55-byte
wrapper), `package.json`, `README.md`, with an exact `patina-cli@8.7.0`
dependency. Lifecycle scripts: root has only `prepublishOnly`
(release gates); the alias has none. Neither package has `postinstall`,
`prepack`, `prepare`, artifact-copy, or code-generation lifecycle behavior —
the tarball is a plain `files`-list projection of the repository tree.

### Category contributions (from the actual packed file list)

Unpacked bytes (exact) and approximate packed bytes (sum of per-file
`gzip -9`; overestimates the true marginal cost because the real tarball
shares redundancy across files — the estimate totals 1,696,176 B vs the
actual 1,519,774 B locally built tarball):

| Category | Unpacked B (% of 5,699,381) | Packed est. B (% of est. total) |
|---|---:|---:|
| `docs/` total | 2,300,648 (40.4%) | 613,548 (36.2%) |
| — `docs/research/` | 947,096 (16.6%) | 294,724 (17.4%) |
| — `docs/benchmarks/` | 720,997 (12.6%) | 91,986 (5.4%) |
| — other `docs/` | 632,555 (11.1%) | 226,838 (13.4%) |
| `src/` | 1,124,347 (19.7%) | 382,446 (22.6%) |
| `artifacts/rebaseline-2025/` | 439,339 (7.7%) | 27,671 (1.6%) |
| `scripts/` non-research (27 files) | 327,844 (5.8%) | 107,307 (6.3%) |
| `patterns/` | 314,949 (5.5%) | 129,278 (7.6%) |
| `playground/` + `vercel.json` | 306,156 (5.4%) | 105,519 (6.2%) |
| root files (`CHANGELOG.md` 101,417; `SKILL.md` 53,760; READMEs; config) | 210,181 (3.7%) | 83,453 (4.9%) |
| `tests/quality/` + `tests/fixtures/` | 235,412 (4.1%) | 92,764 (5.5%) |
| `lexicon/` (incl. `provenance/*.json` 56,941) | 95,799 (1.7%) | 14,999 (0.9%) |
| `core/` | 93,206 (1.6%) | 38,439 (2.3%) |
| `assets/` (aside 39,156; social 28,690; brand 3,863; demo README 3,654) | 75,363 (1.3%) | 24,858 (1.5%) |
| `document-types/` | 62,611 (1.1%) | 32,642 (1.9%) |
| `scripts/research/` (6 files) | 62,065 (1.1%) | 20,326 (1.2%) |
| `personas/` | 28,215 (0.5%) | 14,668 (0.9%) |
| `bin/` + `integrations/aside/` | 23,246 (0.4%) | 8,258 (0.5%) |

Largest single files: `artifacts/rebaseline-2025/human-controls.public.jsonl`
(398,099), `docs/benchmarks/live-scorer-20260905.json` (347,829),
`docs/research/model-rewrite-confirmation-20260905.json` (154,111),
`CHANGELOG.md` (101,417), `docs/API.md` (85,935), `playground/chatgpt.js`
(84,797), `docs/benchmarks/latest.json` (84,213).

## 2. How shipped assets are reached (evidence kinds)

**Direct evidence (read in source this audit):**

- `src/config.js` resolves `REPO_ROOT = resolve(__dirname, '..')`; in an
  installed package that is the package root. All runtime asset loading is
  package-relative:
  - `loadConfig` defaults to `.patina.default.yaml` (`src/config.js:29`);
  - `src/loader.js` globs/reads `patterns/{lang}-*.md`,
    `document-types/*.md`, `personas/{lang}/*.md`, `lexicon/ai-*.md`,
    `core/*.md`, plus user `custom/` shadowing (custom is intentionally not
    shipped);
  - `SKILL.md` (the Claude-skill runtime orchestrator) references
    `core/stylometry.md`, `core/scoring.md`, `core/voice.md`, `core/baseline`,
    `core/diff`, `document-types/default.md`, `lexicon/ai-ko.md`.
- `bin` contract: `patina` and `patina-cli` → `bin/patina.js`;
  `patina-score` → `scripts/precommit-score.mjs`, which imports
  `scripts/prose-score.mjs` (both shipped — the public `patina-score` bin
  would break without the pair).
- `patina aside skill` reads `integrations/aside/SKILL.md` and fails with
  `aside_skill_missing` if it is absent (`src/commands/aside.js:97-99`);
  the aside options server serves `assets/aside/options.{html,js,css}` via
  `readFileSync` (`src/aside/server.js:12,69`). Both are public CLI surface
  (`docs/integrations/aside.md`, shipped).
- `tests/quality/benchmark.mjs:26-28` reads
  `tests/fixtures/suspect-zones/{lang}/{ai,natural}/*.md` and
  `expected-ranges.json`; `tests/quality/live-quality.mjs` reads
  `live-fixtures.jsonl` and `tests/fixtures/live-quality/`. The shipped
  quality harness runs from the installed package (`npm run benchmark` is a
  documented QA profile).
- Shipped `tests/quality/live-{quality,scorer-benchmark}.mjs` import the six
  shipped `scripts/research/*` modules (`model-evaluation-transport`,
  `model-rewrite-benchmark`, `study-{job,journal,validation,inputs}`), as do
  the in-repo unit tests.
- Shipped scripts and npm-script entry points read/write the shipped data
  surfaces: `benchmark:register-pilot` takes
  `artifacts/rebaseline-2025/human-controls.public.jsonl` as `--input`;
  `scripts/adversarial-mps-report.mjs` defaults its output to
  `docs/research/adversarial-mps.md`; `scripts/benchmark-report.mjs`,
  `katfish-calibration.mjs`, `lexicon-freshness.mjs`, `robustness-report.mjs`,
  `detector-comparison.mjs`, `rebaseline-*.mjs`, `perf-report.mjs` read/write
  under `docs/benchmarks/`; `tests/quality/dogfood.mjs` (a `prepublishOnly`
  gate) reads `docs/social/signs-of-ai-writing{,_KR}.md`;
  `scripts/public-showcase.mjs` generates `docs/social/multilingual-examples.md`
  and `assets/social/patina-before-after-*.svg`.
- Shipped docs link shipped assets and each other: `README.md` →
  `assets/brand/patina-mark.svg`, `assets/demo/README.md`, and 17–23 `docs/`
  paths per language README; `docs/DEMO.md` → share-card SVGs and
  `scripts/public-showcase.mjs`; `docs/integrations/playground.md` →
  `playground/*`, `vercel.json`, `assets/social/patina-og.svg`;
  `docs/research/model-guide-20260905.{md,json}` → the
  `provider-*-20260905.{md,json}` evidence cluster and
  `docs/benchmarks/live-scorer-20260905.*`;
  `tests/quality/README.md` (shipped) → `docs/benchmarks/*` and
  `docs/HARNESS.md`.
- 24 of the 33 shipped `scripts/` files are referenced by name from
  `package.json` scripts. The other nine are accounted for: the
  `patina-score` bin chain (`scripts/precommit-score.mjs` →
  `scripts/prose-score.mjs`), the documented packaged comparator
  `scripts/iterative-rewrite-baseline.mjs` ([ARCHITECTURE.md](../ARCHITECTURE.md)),
  the doc-linked showcase generator `scripts/public-showcase.mjs`
  (`docs/DEMO.md`), and the five `scripts/research/study-*` /
  `model-evaluation-transport` modules imported by the shipped quality
  harness and 24 unit-test files. `scripts/lint.mjs` backs `lint:syntax`;
  `scripts/check-release-metadata.mjs` backs `release:check`.

**Checks performed beyond static ESM imports** (none of which produced an
"unused" verdict): dynamic `import()` and `require` of shipped modules;
string-literal `fs`/path construction against `getRepoRoot()`; glob discovery
in `src/loader.js` and the quality harness; subprocess/fork use
(`src/commands/aside.js` forks `src/aside/server.js`); `package.json` script
entry points; `vercel.json` function `includeFiles`; `.github/workflows`
(release/test/publish-dataset) references; tarball-exercising tests
(`tests/{unit,e2e}/release-artifacts.test.js`,
`check-no-private-assets.test.js`, `maintenance-workflows.test.js`,
`perf-report.test.js`); the machine-checked import graph
(`scripts/check-architecture.mjs`, which treats a declared-but-unreachable
published bin as a failure).

**Inference (labeled as such):** `playground/` + `vercel.json` ship as a
mirror of the hosted playground surface. The hosted deployment builds from
the git repository, not from the npm tarball, and no shipped document found
instructs a user to self-host the playground out of an installed package.
Their npm-tarball audience is therefore inference: plausible self-hosting /
documentation completeness, not a confirmed consumer.

**Unknown external usage:** no `exports` map → every shipped path is
deep-importable. No registry download/telemetry data was consulted. All
"external usage" cells below are `plausible/unknown` or `no evidence found`,
never "confirmed unused".

## 3. Candidate table

"Validation required before exclusion" lists what an owner would still need
even for a `POSSIBLE EXCLUSION` row; no such validation was started here.

| Path / category | Why it ships today | Known in-repo consumers | Dynamic/path-based consumers checked | Public/documented contract | Packed est. | External usage | Disposition | Validation required before exclusion | Compatibility risk |
|---|---|---|---|---|---:|---|---|---|---|
| `bin/`, `src/` | CLI implementation | everything | fs/glob via `getRepoRoot()`; fork in `commands/aside.js`; architecture graph | `patina`/`patina-cli`/`patina-score` bins; `docs/CLI.md`; HTTP contract | ~391 KB | plausible/unknown (deep imports) | **KEEP** | n/a (runtime core) | total breakage |
| `core/`, `patterns/`, `document-types/`, `lexicon/`, `personas/`, `SKILL.md`, `.patina.default.yaml` | skill + CLI runtime assets | `src/loader.js`, `src/config.js`, `SKILL.md`, Vercel `includeFiles` | glob discovery `patterns/{lang}-*.md`; `custom/` shadowing | skill surface; `--document-type/--persona/--register` axes; `docs/HTTP-API.md` server assets | ~215 KB | plausible/unknown | **KEEP** | n/a (runtime core) | total breakage |
| `scripts/precommit-score.mjs` + `scripts/prose-score.mjs` | `patina-score` public bin | `package.json` bin; CI score gate | import chain inside bin | declared bin name | ~9 KB | plausible/unknown | **KEEP** | n/a (declared bin) | bin breaks |
| other shipped `scripts/` (27 files, non-research) | npm-script entry points + gates | 23/27 referenced by `package.json` scripts (other 4: `patina-score` chain ×2, documented comparator, doc-linked showcase generator) | script→script imports; outputs into `docs/benchmarks`, `docs/research`, `artifacts/` | `docs/HARNESS.md` tool map; QA profiles; `iterative-rewrite-baseline` documented comparator | ~107 KB | plausible/unknown (deep-importable, incl. documented comparator) | **KEEP** | registry-side import telemetry + owner decision per script | broken documented commands; deep-import breaks |
| `scripts/research/` (6 files) | study transport/journal/validation libs | shipped `tests/quality/live-scorer-benchmark.mjs`; 24 unit-test files; `quality:model-rewrite` script | ESM imports from shipped harness | harness tool map (`docs/HARNESS.md` lane 4, opt-in) | ~20 KB | plausible/unknown | **KEEP** | same as above | shipped live-quality harness stops importing |
| `tests/quality/` + `tests/fixtures/` | shipped measurement harness + labeled fixtures | `npm run benchmark` (QA profile), `dogfood`, `quality:live` | fs reads of `suspect-zones/**`, `expected-ranges.json`, `live-fixtures.jsonl`, `fixtures/live-quality/` | `docs/QA.md` profiles; `tests/quality/README.md` (shipped) | ~93 KB | plausible/unknown | **KEEP** | n/a (documented QA profile) | documented benchmark no longer runs from installed package |
| `artifacts/rebaseline-2025/` (7 files; `human-controls.public.jsonl` 398 KB) | public rebaseline corpus evidence + example inputs | `benchmark:register-pilot` npm script; shipped `rebaseline-*.mjs`, `katfish-calibration.mjs`, `signal-impact.mjs`; unit tests; `docs/research/2025-rebaseline-plan.md` etc. | `--input` path args; JSONL reads | rebaseline plan docs; provenance/README inside dir | ~28 KB (JSONL compresses ~14×) | plausible/unknown | **KEEP** | owner-approved relocation of research originals + updating every referencing script/test/doc | historical-evidence policy violation; broken shipped scripts |
| `docs/research/` (73 files, 947 KB unpacked) | dated historical research evidence; shipped-script output target | `adversarial-mps-report.mjs` (default output); `benchmark-report.mjs` link; `export-hf-dataset.mjs`; unit tests (`model-*`, `study-*`, `mps-*`); cross-links from `model-guide-20260905.*` and shipped `tests/quality/README.md` | fs writes by shipped scripts; doc deep-links | "historical plans, research, benchmark records remain labeled" (AGENTS.md); `docs/RESEARCH-DOCS-PLATFORM.md` | ~295 KB | plausible/unknown | **KEEP** | owner-approved evidence relocation, link repair, script default-output change, external-link audit | breaks shipped script defaults and evidence links; contradicts historical-evidence policy |
| `docs/benchmarks/` (38 files, 721 KB unpacked; `live-scorer-20260905.json` 348 KB) | generated public benchmark reports + receipts | shipped `benchmark-report.mjs`, `katfish-calibration.mjs`, `robustness-report.mjs`, `detector-comparison.mjs`, `rebaseline-*.mjs`, `perf-report.mjs`, `lexicon-freshness.mjs`; CI drift gate; `playground/index.html` links; `tests/quality/README.md` | fs read/write by shipped generators; CI `git diff --exit-code docs/benchmarks` | public benchmark pages; `docs/benchmarks/README.md` claim rules | ~92 KB (JSON compresses ~4×) | plausible/unknown | **KEEP** | owner decision + regenerating every report elsewhere + CI drift-gate change | public claims lose their shipped receipts |
| other user-facing `docs/` (50 files: API/CLI/PATTERNS-*/EXAMPLES*/FAQ*/integrations/social/…; 632 KB unpacked) | user documentation, shipped wholesale via `docs/` glob | README links (17–23 per language); `dogfood.mjs` reads `docs/social/*`; `public-showcase.mjs` writes `docs/social/` | fs reads in dogfood; generator writes | installation/support docs the Korean-translation policy pairs; `docs/integrations/*` contracts | ~227 KB | plausible/unknown | **KEEP** | per-file consumer + link audit (large, low value) | broken README/doc links; dogfood gate input disappears |
| development-policy docs subset: `WORKFLOW.md`, `QA.md`, `ARCHITECTURE.md`, `HARNESS.md`, `ROADMAP.md`, `RESEARCH-DOCS-PLATFORM.md` (91,635 B unpacked; `WORKFLOW.md` grew 20,681 → 21,505 B with PR #846) | ships because `docs/` ships wholesale; only `docs/internal/**` and `docs/operations/**` are excluded | `HARNESS.md` linked from shipped `tests/quality/README.md`; `ARCHITECTURE.md` cited in source comments; others none found in shipped runtime | doc cross-links only (no fs consumer found) | contributor policy, not a user contract | ~37.6 KB gz est | plausible/unknown | **INSUFFICIENT EVIDENCE** | owner decision + HARNESS link repair in shipped README + registry telemetry; saves ≈1.6% unpacked / ≈2.5% packed est | marginal benefit; breaks shipped README cross-links if removed blindly |
| `playground/` + `vercel.json` | mirror of the hosted playground surface | `docs/integrations/playground.md` (shipped) documents every file; `vercel.json` `includeFiles` pins the server assets | none found that load playground files from an installed package | hosted playground docs; browser regression test (in-repo only) | ~106 KB | plausible/unknown (self-host inference, §2) | **KEEP** | documented self-host contract decision + registry telemetry | undocumented-consumer risk; doc links break |
| `assets/aside/` + `integrations/aside/` | aside integration runtime assets | `src/aside/server.js` (serves `options.*`), `src/commands/aside.js` (reads `SKILL.md`) | `readFileSync` at request time; `existsSync` + explicit error | public `patina aside` commands; `docs/integrations/aside.md` | ~15 KB (aside assets 13,130 gz) | plausible/unknown | **KEEP** | n/a (CLI runtime) | `patina aside skill/options` fail at runtime |
| `assets/brand/`, `assets/social/`, `assets/demo/README.md` | README/demo/share-card assets | `README.md` → brand mark + demo README; `docs/DEMO.md` → social SVGs; generated by shipped `public-showcase.mjs` / `share-card.mjs` flow | generator writes; README relative links (rendered on npm) | npm README presentation; `docs/BRANDING.md` | ~12 KB | plausible/unknown | **KEEP** | n/a (README-linked) | broken images/links on the npm page |
| `CHANGELOG.md`, `README*`, `LICENSE`, `NOTICE` | standard package metadata | npm registry display | none needed | conventional npm contract | ~84 KB root total (CHANGELOG.md ≈ 39.6 KB gz) | confirmed (registry display) | **KEEP** | n/a | non-compliant package |
| alias `packages/patina-humanizer` | SEO alias package | depends on exact `patina-cli@8.7.0` | 55-byte bin wrapper | alias bin `patina-humanizer` | 628 B packed | plausible/unknown | **KEEP** | n/a | breaks the alias |

### Apparently unused code / dependencies sweep (no removals proposed)

- No `TODO`/`FIXME` markers in `src/` at this SHA.
- One conditional test skip found (`tests/unit/edit-review.test.js:37`,
  WebCrypto availability on old Node) — environment-conditional, documented
  in place; not a disabled test in the "silently skipped" sense.
- No unused runtime dependency: `js-yaml` (the only production dependency)
  is imported by `src/loader.js`, `src/config.js`, `src/commands/persona.js`,
  `src/web-config.js`. All devDependencies are exercised by shipped tooling
  (`eslint.config.js`, `tsconfig.json` `types: ["node"]`, `cspell.json`,
  `scripts/check-architecture.mjs` → espree, `scripts/generate-api-docs.mjs`
  → jsdoc-to-markdown, `tests/browser/` → playwright, release workflow →
  semver). DevDependencies are not installed by consumers and do not affect
  tarball size.
- The machine-checked architecture graph (120 modules, 420 edges) reported
  zero violations at this SHA; a declared-but-unreachable published bin is a
  graph failure by design, so "unused public executable" is continuously
  guarded already.

## 4. Classification outcome

Every candidate above resolves to **KEEP**, except the development-policy
docs subset (`WORKFLOW.md`, `QA.md`, `ARCHITECTURE.md`, `HARNESS.md`,
`ROADMAP.md`, `RESEARCH-DOCS-PLATFORM.md`), which is
**INSUFFICIENT EVIDENCE** — no in-repo runtime consumer was found, but the
saving is ≈1.6% unpacked (91,635 B) / ≈2.5% packed-estimate at best, one of
them (`HARNESS.md`) is cross-linked
from a shipped harness README, and external deep-access cannot be ruled out.
That is not enough to justify an exclusion PR by itself.

**Overall: `KEEP / NO PR-08 FOLLOW-UP`.**

Rationale: the three byte-heavy candidates (`docs/research/` 947 KB,
`docs/benchmarks/` 721 KB, `artifacts/rebaseline-2025/` 439 KB unpacked) are
exactly the historical-evidence and public-claim surfaces that shipped
scripts read/write and that repository policy explicitly preserves dated and
labeled. Their *packed* marginal cost is far smaller than the unpacked
numbers suggest (≈295 + 92 + 28 KB of a 1.52 MB tarball), the whole package
is 1.45 MiB packed, and any exclusion would simultaneously (a) risk external
deep-import breakage that cannot be measured from this repository, (b) break
shipped script default outputs and cross-linked receipts, and (c) require
owner-approved relocation of research originals. No exclusion path
demonstrates a safe, worthwhile benefit at this time.

## 5. Validation record (audited tree `3c078b1…`; every check re-run at the
refreshed tree after the `origin/dev` merge — numbers from `67e0cd8…` were
not reused)

| Command | Result | Exit |
|---|---|---:|
| `npm pack --dry-run --json` (root) | 500 files, 1,519,774 B packed, 5,699,381 B unpacked | 0 |
| `npm pack --dry-run --json` (in `packages/patina-humanizer`) | 3 files, 628 B packed, 972 B unpacked | 0 |
| `node scripts/release-artifacts.mjs --output-dir /tmp/maint07-release-artifacts-2 --source-sha 3c078b1…` | "Verified 8.7.0 release artifacts" — both tarballs locally built, hashed (root `bb611a67…`, alias `63be3af3…`), metadata-verified, and clean-install smoked (no publish; `--publish` not passed) | 0 |
| `npm run benchmark:perf -- --costmetrics` | report-only: npm tarball 1,519,774 B; CLI coldstart 75.697 ms mean over 3 fresh processes; analyzer p50 0.198–2.141 ms across 7 fixtures. Regenerated `docs/benchmarks/perf-latest.{md,json}` in the worktree; snapshot preserved for this audit and the generated files restored to HEAD (generated drift is not part of this PR) | 0 |
| `npm run release:check` | metadata + retired-concepts gates pass | 0 |
| `npm run check:no-private-assets` | "0 forbidden paths across 503 packed + 1388 tracked file(s)" | 0 |
| `npm run lint` (syntax, ESLint, tsc, CSpell, `check:architecture`) | "Architecture boundaries OK — 120 module(s), 420 edge(s), 0 violation(s)"; CSpell 32 files, 0 issues | 0 |

Not run: `npm run test:unit` / `test:e2e` / `benchmark` / `dogfood` (no
product code changed; the tarball-exercising suites already ran indirectly
inside the release-artifacts install smoke, which executes the packed CLI),
and all model-backed profiles (out of scope and unauthorized for a docs-only
audit). None of these omissions weakens the audit's claims because no
behavior changed.

## 6. Known unknowns

- No registry-side download or import telemetry was consulted; external
  usage of any shipped path (including `scripts/**` and `docs/**`) is
  unmeasured. Any future exclusion decision still needs that evidence or an
  owner-accepted compatibility break.
- The npm-tarball audience of `playground/` + `vercel.json` is inferred
  (self-hosting/documentation mirror), not confirmed by a documented
  install-from-package procedure.
- Packed-per-category figures are per-file gzip estimates (upper bounds),
  not measurements of the real tarball's internal redundancy.
- The tarball hashes and byte totals in §1 are measurements of the audited
  tree's locally built packaging output, not of the registry-published 8.7.0
  artifacts. No registry download or byte-comparison was performed — no
  existing repository procedure requires it for this audit, and the purpose
  here is packaging-reachability analysis before future exclusions, not
  release forensics.

## 7. Non-goals honored

No `package.json` field, file, dependency, bin name, version, CLI flag,
research asset, or repository setting was changed by this audit. Rollback of
this PR is reverting this single document. PR-08 (exclusion implementation)
is **not** justified by current evidence and was not started.
