# Contributing to Patina

Thanks for considering a contribution. Patina is a pattern-based tool, so the most impactful contributions are usually new patterns, better examples, Document Type policies, or Persona refinements.

## Documentation boundaries

The tracked tree is public by default. Keep these roles distinct:

- **Development policy:** `AGENTS.md`, this file, and the linked
  `docs/WORKFLOW.md`, `docs/ARCHITECTURE.md`, and `docs/QA.md`.
- **Product documentation and assets:** `README*.md`, `SKILL.md`, `core/`,
  `patterns/`, `document-types/`, `personas/`, `examples/`, and user-facing
  material under `docs/`.
- **Reviewed operational evidence:** a sanitized, explicitly approved record
  may live under `docs/operations/`; it is not a substitute for user docs.
- **Historical evidence:** dated plans, research, and benchmark records remain
  labeled with their date, conditions, and source revision. Do not rewrite an
  historical result as a current claim.

Private runbooks, raw user or model text, review/run logs, credentials, tokens,
personal profiles, and local QA workspaces belong outside the public tree.
`docs/internal/`, `.gjc/`, `.omo/`, `.omc/`, `.insane-review/`, and ignored
scoped agent files are guards for private material, not publication targets.
Never copy a private parent `AGENTS.md` or its contents into this repository.
Do not put private material in issues, telemetry, package tarballs, or examples.

The root `AGENTS.md` is the public repository-development entrypoint; no
product instructions belong there. This repository grants no external
publication, registry, deployment, account, or release rights. Maintainer
approval and the documented release process are required for every external
write. When moving a public root document, link it from `README.md`; private
material must not be moved into the repository.

## Development workflow and canonical references

Use one branch and worktree per session, normally branched from `dev`, and keep
each PR to one behavior, contract, or responsibility change. The complete
branch, PR/Issue, review, merge, and release policy is
[`docs/WORKFLOW.md`](docs/WORKFLOW.md). Read
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for module ownership and public
contracts, and [`docs/QA.md`](docs/QA.md) for verification profiles, evidence,
and isolation. Do not duplicate those documents here.

## Korean Translation Policy

Primary user docs should keep a Korean companion when they explain installation, support, contribution, examples, or troubleshooting. The required pairs are:

- `README.md` → `README_KR.md`
- `CONTRIBUTING.md` → `CONTRIBUTING_KR.md`
- `docs/FAQ.md` → `docs/FAQ_KR.md`
- `docs/AUTHENTICATION.md` → `docs/AUTHENTICATION_KR.md`
- `docs/EXAMPLES.md` → `docs/EXAMPLES_KR.md`

When a PR changes one of these English files, update the Korean pair in the same PR or explain why the translation can safely lag. Keep commands, paths, config keys, issue numbers, and code fences unchanged unless the source file itself changes them.

## Adding a New Pattern

1. **Pick the right pack.** Patterns live in `patterns/{lang}-{category}.md`. Categories: content, language, style, structure, communication, filler, plus the score-only `viral-hook` pack.

2. **Follow the template.** Each pattern needs:
   - Number (next available, e.g. #30)
   - Watch words
   - Fire condition (when should it trigger?)
   - Exclusion condition (when should it NOT trigger?)
   - Problem description
   - Before/after example

3. **Add to all languages you can.** We have 4 language packs (ko, en, zh, ja). If you only know one, that's fine — file the PR for that language and note the others need translation.

4. **Update counts.** After adding a pattern:
   - Pack header: increment `patterns:` count
   - `docs/PATTERNS.md` and `docs/PATTERNS-{lang}.md`: regenerate the catalog; README `Facts` row: update the total
   - SKILL.md description: update total if hardcoded

5. **Add an example.** If possible, add `examples/{lang}-{number}-success-01.md` and `examples/{lang}-{number}-failure-01.md` (false positive case).

## Improving an Existing Pattern

The most common improvement: better before/after examples. The "after" text should preserve the original meaning — not rewrite it into something different.

Good test: if someone read only the "after" text, would they get the same takeaway as the "before"? If the sentiment flips, the example is bad.

## Pattern Evaluation Checklist

Before opening a pattern PR, check:

- **Fire condition:** would at least 2-3 real AI-generated examples trigger it?
- **Exclusion condition:** can a human-written, domain-appropriate example avoid the hit?
- **Semantic risk:** what facts, numbers, polarity, causation, or domain terms could be damaged by the rewrite?
- **Before/after pair:** does the after version preserve the same claims without merely swapping synonyms?
- **Freshness evidence:** link a 50-document hot/cold fixture, manifest, or collection plan when proposing an emerging model-era tell.
- **Count sync:** pack frontmatter `patterns:` must match numbered `### N.` pattern headings.

## False Positive Triage Workflow

False positives are expected, especially for academic, encyclopedic, legal, corporate, or heavily edited prose. To report one:

1. Use the false-positive issue template.
2. Include language, genre/register, score/audit excerpt, and the specific pattern that over-fired.
3. Remove private text or replace it with a minimal redistributable excerpt.
4. Suggest whether the fix should be an exclusion rule, lower severity, Document Type `pattern-overrides` change, or benchmark fixture.

Maintainers should prefer tightening exclusions over deleting patterns outright.

## Adding Benchmark Fixtures

Suspect-zone fixtures live under `tests/fixtures/suspect-zones/{lang}/{ai|natural}/`.

Each fixture needs YAML frontmatter:

```yaml
---
fixture_id: en-ai-07-example
language: en
class: ai
expected_hot: true
why_designed_this_way: |
  Explain which deterministic signal should fire and why.
expected_metrics:
  cv_band: low
---
```

Then run:

```bash
npm run benchmark:report
```

This regenerates `tests/quality/results.json`, `docs/benchmarks/latest.json`, and `docs/benchmarks/latest.md`.

## Adding a Deterministic Detection Signal

Patterns (above) are LLM-executed catalog entries. A **detection signal** is
different: a deterministic hot/cold input computed in `src/features/*` and
folded into the per-paragraph hot OR rule (burstiness, MATTR, lexicon density,
the Korean diagnostics composite, the ending-monotony signal, etc.). The
analysis layer stays LLM-free, so a new signal is real engineering with a
calibration bar. Follow this loop:

1. **Diagnose the miss with evidence.** Find where detection fails on a labeled
   manifest, not by intuition. `score_review.trigger_counts` in the scored
   manifests shows which signals fire on which rows; `npm run benchmark:signal-impact`
   reports each existing signal's marginal catch/FP so you can see the gap.
2. **Find a false-positive-safe discriminator.** Compare AI misses against human
   controls **at matched length/register** (a short-text confound is not an AI
   tell). The discriminator must separate AI from *the human register that
   shares the surface feature* — e.g. plain `-다` AI vs formal-human `-다` needed
   a burstiness conjunct, not `-다` alone.
3. **Implement it first-class, never by coupling an advisory payload.** Advisory
   signals (`translationese`, `koPostEditese.v1`) must not feed the hot verdict
   (see [docs/TRANSLATIONESE-KO.md](docs/TRANSLATIONESE-KO.md)). Add a dedicated
   computation in `src/features/stylometry.js`, wire it into the hot OR in
   `src/features/index.js`, and add a precision gate (length/count floors) if it
   over-fires on short or corner-case text.
4. **Keep runtime surfaces aligned.** A signal is not done until it is consistent across:
   `src/features/index.js` / server-side feature callers such as
   `src/web-rewrite-stream.js`, `scripts/rebaseline-score.mjs`
   `trigger_counts`, the hot-rule prose in `core/stylometry.md` and `SKILL.md`,
   and unit tests (including precision guards). The browser playground is a
   `playground/chatgpt.js` UI over server-side detection/scoring, not a separate
   deterministic-analysis mirror.
5. **Measure with the harness, not by hand.** Run `npm run benchmark:signal-impact`
   for the marginal before/after, `npm run benchmark` (the 49-fixture suite must
   stay 100% — natural fixtures must not flip hot), and confirm the human-control
   false-positive rate stays within the published CI in
   `docs/benchmarks/rebaseline-latest.md`. Record the measured numbers in the
   changelog. The frozen public claim manifests are refreshed in a separate
   rebaseline pass, not in the signal PR.
6. **Record the release impact.** A new detection signal changes hot behavior
   and normally warrants a **minor** release (it is additive, not a removal).
   Record that impact and the measured catch/FP deltas in the PR, but leave
   package and mirror updates to the release process.

Acceptance bar (mirrors the roadmap's deterministic-feature-expansion criteria):
recall or precision improves on the labeled manifest, the human-control
false-positive rate stays within the published tolerance, and the signal ships
with a documented failure mode plus before/after examples.

See [docs/HARNESS.md](docs/HARNESS.md) for the full measurement-tool map.

## Translating Examples

- Preserve the original semantic anchors: numbers, entities, negation, causation, and modality.
- Do not translate an English AI tell literally if it is not a tell in the target language.
- Add a target-language false-positive note when a phrase is normal in that register.
- Keep examples redistributable; do not paste private user text.

## Adding a Document Type

Document Types live in `document-types/{name}.md`. Copy an existing policy
(for example `blog.md`), set `document-type:` to the filename stem, and define
`scope`, `purpose`, `audience`, `structure`, `style`, `avoid`, and
language-scoped `pattern-overrides`. `suppress` is applied deterministically;
`reduce`/`amplify` document policy intent but do not currently change a runtime
weight. Keep Persona voice, casual/professional Register markers, and
verification thresholds out of this axis.

For reusable voice, create a Persona v2 with `patina persona new`. Persona
frontmatter is validated to reject document policy, Register, and safety fields.

## Pattern Staleness

AI writing patterns evolve as models get fine-tuned. Some patterns decay (e.g. "delve" after it became a meme), while new ones emerge. 

How we handle this:
- **Community reporting:** If you notice a pattern that's no longer a reliable signal, open an issue
- **New pattern proposals:** If you spot a new AI tell, file an issue with 3+ real-world examples and a 50-document evaluation fixture or collection plan
- **Quarterly review:** Maintainers follow [`process/pattern-freshness.md`](process/pattern-freshness.md) for corpus freeze windows, promotion thresholds, and frontmatter metadata
- **Lexicon provenance:** Newly mined or re-mined lexicon entries need `added`, `source`, and `last_validated` provenance before changing shipped behavior; run `npm run lexicon:freshness` to verify sidecars match the shipped entries
- **Version notes:** Each pattern pack has a `version` field. Record its
  compatibility impact when patterns change; release preparation updates
  package and mirror versions through the documented process.
- **No deletion without replacement:** We don't remove patterns outright; we mark them as `low` severity or move them to `reduce` in a Document Type policy

## Versioning and releases

Record the expected semver impact in a feature or documentation PR, but do not
bump the package version there. Version changes are release-only: the release
PR updates `package.json` (the source of truth), its documented mirrors, and
the matching `CHANGELOG.md` entry once. Use the checks and version-bearing-file
list in [`docs/WORKFLOW.md`](docs/WORKFLOW.md); `npm run release:check` must
remain the final metadata check. Include a short semver rationale in each
release entry. Pattern-pack and Document Type metadata may have their own
compatibility rules, but must not silently change the package release version.

## Code of Conduct

Be helpful. Don't be a jerk. AI writing patterns are not moral failings — we're building a tool, not a tribunal.

## PR Process

1. Branch from `dev` and make the smallest independently reviewable change.
2. Explain the problem, scope, non-goals, public-contract impact, risk, and
   rollback. Include the relevant test or fixture and its evidence.
3. Keep implementation, regression coverage, and required public documentation
   together; separate unrelated cleanup, generated output, and release bumps.
4. Open the PR into `dev` with a clear description. Use the release workflow
   for the later `dev` → `main` merge; a feature PR is not a release.
5. Include before/after examples for pattern changes and state any check that
   was not run or is blocked. Do not treat an unrun or stale check as passing.
