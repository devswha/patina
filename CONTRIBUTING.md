# Contributing to Patina

Thanks for considering a contribution. Patina is a pattern-based tool, so the most impactful contributions are usually new patterns, better examples, or profile refinements.

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

## Code of Conduct

Be helpful. Don't be a jerk. AI writing patterns are not moral failings — we're building a tool, not a tribunal.

## PR Process

1. Fork and branch from `main`
2. Make your changes
3. Verify pattern counts are consistent
4. Open a PR with a clear description
5. Bonus: include before/after examples that demonstrate your change
