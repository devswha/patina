# Contributing to Patina

Contributions include CLI fixes, detection signals, patterns, examples,
Document Types, Personas, integrations, and documentation.

## Finding your way around

- `src/`, `api/`, and `playground/` contain executable product code.
- `SKILL.md` and `core/` describe the product's text-processing flow.
- `patterns/`, `document-types/`, `personas/`, and `examples/` hold product assets.
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) explains the current module layout.
- [QA.md](docs/QA.md) lists test commands and their coverage.
- [WORKFLOW.md](docs/WORKFLOW.md) provides Git, CI, and release examples.
- `docs/research/` contains dated studies and proposals; `docs/operations/`
  contains runbooks and past operating records.

## Local development

The development checks use Node 24. The published CLI's minimum Node version
is recorded in `package.json`.

```bash
npm ci
npm test
npm run lint
```

Focused tests are useful during implementation, and `npm run test:browser`
exercises the playground with Chromium fixtures. Additional commands live in
`package.json` and the [harness guide](docs/HARNESS.md).

## Adding a new pattern

Patterns live in `patterns/{lang}-{category}.md`. Categories include content,
language, style, structure, communication, filler, and the score-only viral-hook
pack. Existing pack frontmatter and numbered `### N.` entries show the format:

- Watch words and a fire condition.
- Exclusions and false-positive examples.
- A description of the editing problem.
- Before/after text with the intended meaning preserved.

The language packs are Korean, English, Chinese, and Japanese. A contribution
can start with any one of them. The optional [pattern proposal form](.github/ISSUE_TEMPLATE/pattern_proposal.yml)
and [pattern-of-the-week example](docs/community/pattern-of-the-week.md) can
help organize an idea.

Pack frontmatter records `patterns:` counts. The catalog is in
`docs/PATTERNS.md` and `docs/PATTERNS-{lang}.md`; examples live in `examples/`.
Count changes can also affect README and SKILL metadata.

Patterns can be added, revised, reduced, or removed as evidence changes.
[Pattern freshness](process/pattern-freshness.md) describes available tools and
provenance fields.

## False positives and fixtures

A useful false-positive report includes the language, writing context, observed
signal, and a small shareable reproduction. Possible fixes include an exclusion,
a changed detector, a Document Type override, or removal of an unreliable pattern.

Suspect-zone fixtures live in `tests/fixtures/suspect-zones/{lang}/{ai|natural}/`.
Their frontmatter describes the fixture and expected measurements:

```yaml
---
fixture_id: en-ai-07-example
language: en
class: ai
expected_hot: true
why_designed_this_way: |
  Explain which deterministic signal this fixture exercises.
expected_metrics:
  cv_band: low
---
```

`npm run benchmark:report` regenerates `tests/quality/results.json`,
`docs/benchmarks/latest.json`, and `docs/benchmarks/latest.md`.

## Detection signals

The current analyzer in `src/features/` computes signals locally without a
model or network. `src/features/index.js` combines them into paragraph and
document results. [ARCHITECTURE.md](docs/ARCHITECTURE.md) maps the callers and
public outputs; `core/stylometry.md` explains the current scoring behavior.

`npm run benchmark:signal-impact` compares signal contributions and false
positives. Matched human controls, examples of missed detections, and results
by language/register help evaluate a proposed detector. The same tools can
support experiments with new approaches and revisions to existing ones.

## Document Types and Personas

Document Types live in `document-types/{name}.md`. Their frontmatter includes
`document-type`, `scope`, `purpose`, `audience`, `structure`, `style`, `avoid`,
and language-scoped `pattern-overrides`. `suppress` currently affects
deterministic analysis; `reduce`/`amplify` describe policy intent without a
runtime weighting change.

`patina persona new` creates reusable voice metadata. The current Persona
validator distinguishes voice fields from Document Type, Register, and safety
fields.

## Translations

English/Korean document pairs include `README`, `CONTRIBUTING`, `docs/FAQ`,
`docs/AUTHENTICATION`, and `docs/EXAMPLES`. Comparing both versions helps keep
commands and explanations aligned. Pattern translations can use examples
natural to the target language instead of literal translations of an English tell.

## Versioning and releases

`package.json` is the package-version source. `npm run release:check` validates
its mirrors and CHANGELOG entry, and `npm run release:sync-plugin-versions`
updates the plugin mirrors. [The release guide](docs/integrations/release.md)
explains artifact creation, npm publication, and container delivery.

## PR process

Changes normally reach `main` through a pull request. A helpful description
explains the behavior, reasoning, and relevant checks. Issues are available
for discussion and tracking when useful. Reviews can consider alternatives
and revise the approach as new evidence appears.

The repository is public. Synthetic examples and sanitized summaries are useful
for discussing private inputs without publishing credentials or personal text.
