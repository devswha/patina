# Contributing to Patina

Thanks for considering a contribution. Patina is a pattern-based tool, so the most impactful contributions are usually new patterns, better examples, or profile refinements.

## Public vs. Internal Docs

User-facing documentation lives in `README*.md`, `docs/`, `examples/`, `patterns/`, `profiles/`, and the skill entrypoints. Maintainer or agent notes live under `docs/internal/` and should not be treated as install, CLI, or API contracts unless they are promoted back into the public docs list.

When moving a root-level Markdown file, either link it from `README.md` if it is public, or place it under `docs/internal/` with a short status note explaining its audience.

## Adding a New Pattern

1. **Pick the right pack.** Patterns live in `patterns/{lang}-{category}.md`. Categories: content, language, style, structure, communication, filler.

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
   - README.md and README_KR.md: update pattern tables and totals
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
- **Count sync:** pack frontmatter `patterns:` must match numbered `### N.` pattern headings.

## False Positive Triage Workflow

False positives are expected, especially for academic, encyclopedic, legal, corporate, or heavily edited prose. To report one:

1. Use the false-positive issue template.
2. Include language, genre/register, score/audit excerpt, and the specific pattern that over-fired.
3. Remove private text or replace it with a minimal redistributable excerpt.
4. Suggest whether the fix should be an exclusion rule, lower severity, profile override, or benchmark fixture.

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

## Translating Examples

- Preserve the original semantic anchors: numbers, entities, negation, causation, and modality.
- Do not translate an English AI tell literally if it is not a tell in the target language.
- Add a target-language false-positive note when a phrase is normal in that register.
- Keep examples redistributable; do not paste private user text.

## Adding a Profile

Profiles live in `profiles/{name}.md`. Copy an existing one (e.g. `blog.md`) and adjust:
- `voice-overrides`: which voice dimensions to amplify/suppress
- `pattern-overrides`: per-language pattern severity adjustments

## Pattern Staleness

AI writing patterns evolve as models get fine-tuned. Some patterns decay (e.g. "delve" after it became a meme), while new ones emerge. 

How we handle this:
- **Community reporting:** If you notice a pattern that's no longer a reliable signal, open an issue
- **New pattern proposals:** If you spot a new AI tell, file an issue with 3+ real-world examples
- **Version notes:** Each pattern pack has a `version` field — bump it when patterns change
- **No deletion without replacement:** We don't remove patterns outright; we mark them as `low` severity or move them to `reduce` in profiles

## Versioning Policy

Patina uses semantic versioning for both CLI behavior and pattern-pack compatibility.

- **Major:** remove or renumber patterns, break config/result schemas, change public CLI semantics, or make existing pattern packs incompatible.
- **Minor:** add a pattern, language, profile, mode, backend, benchmark schema field, or contributor-facing workflow.
- **Patch:** fix bugs, adjust severity/exclusions, clarify examples, update docs, refresh benchmark fixtures without changing schemas.

Every changelog entry should include a short semver rationale line so downstream users know whether to pin, test, or upgrade normally.

## Code of Conduct

Be helpful. Don't be a jerk. AI writing patterns are not moral failings — we're building a tool, not a tribunal.

## PR Process

1. Fork and branch from `main`
2. Make your changes
3. Verify pattern counts are consistent
4. Open a PR with a clear description
5. Bonus: include before/after examples that demonstrate your change
