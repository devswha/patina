# Cursor Rules for Patina

## Project Identity

Patina is a **Claude Code skill** that detects and removes AI writing patterns from Korean, English, Chinese, and Japanese text. It rewrites AI-sounding text into natural, human-like prose while preserving meaning through the Meaning Preservation System (MPS).

The project uses a **plugin architecture**: patterns are plugins (`patterns/{lang}-*.md`), profiles are themes (`profiles/*.md`). Inspired by oh-my-zsh.

## File Structure Conventions

- **Pattern packs**: `patterns/{lang}-{category}.md` (e.g., `en-content.md`, `ko-language.md`)
  - Must have valid YAML frontmatter: `pack`, `language`, `name`, `version`, `patterns`
  - Pattern definitions use `### N. Pattern Name` headings
- **Profiles**: `profiles/{name}.md` (e.g., `blog.md`, `academic.md`)
  - Define `voice-overrides` and `pattern-overrides`
- **Core definitions**: `core/voice.md`, `core/scoring.md`
- **Examples**: `examples/{number}-success-01.md`, `{number}-failure-01.md`
  - English examples: `examples/en-{number}-success-01.md`
- **Entry points**: `SKILL.md` (single model), `patina-max/SKILL.md` (multi-model)
- **Config**: `.patina.default.yaml` — source of truth for defaults

## When Adding a New Pattern

1. Pick the correct pack in `patterns/{lang}-{category}.md`
2. Use the exact template:
   ```markdown
   ### N. Pattern Name
   **Watch words:** ...
   **Fire condition:** ...
   **Exclusion:** ...
   **Semantic Risk:** HIGH|MEDIUM|LOW
   **Problem:** ...
   **Before:** > ...
   **After:** > ...
   ```
3. Update the pack's frontmatter `patterns:` count
4. Add to **all 4 languages** if universal. Document if language-specific.
5. Add example files: `examples/{lang}-{number}-success-01.md` and `{lang}-{number}-failure-01.md`
6. Update `README.md` pattern tables
7. Bump the pack's `version:` frontmatter

## When Adding a Profile

1. Copy `profiles/default.md` as a template
2. Define `voice-overrides` (amplify/allow/suppress per voice dimension)
3. Define `pattern-overrides` (amplify/normal/reduce/suppress per pattern number)
   - Use language-scoped overrides to avoid cross-language number collisions:
     ```yaml
     pattern-overrides:
       ko:
         8: amplify
       en:
         8: amplify
     ```
4. If the profile needs custom AI/fidelity balance, add to `.patina.default.yaml` under `ouroboros.combined-weights`
5. Update `README.md` profile table

## When Modifying SKILL.md

- The **3-Phase pipeline** (5a structure → 5b sentence/lexical → 5c self-audit) is sacred. Do not change without explicit request.
- Anchor verification logic must stay in sync with `core/scoring.md`
- CLI flag parsing (`$ARGUMENTS`) must stay in sync with `.patina.default.yaml` options
- Update `patina-max/SKILL.md` if the change affects MAX mode (scoring, ouroboros, profiles)

## When Modifying core/scoring.md

- The scoring formula is canonical — any behavioral change must also update:
  - `SKILL.md` §6 (score mode)
  - `patina-max/SKILL.md` §6 (MAX mode scoring)
- Severity rubric, category weights, and MPS formula are referenced by both skill files

## Version Management

- `.patina.default.yaml` `version:` is the **source of truth**
- `SKILL.md`, `patina-max/SKILL.md`, `README.md` must match it
- Pattern pack versions are independent — bump when patterns change
- Profile versions are independent

## Language Synchronization Rule

All 4 languages (ko, en, zh, ja) must maintain **29 patterns each** (116 total). When adding a universal pattern:
- Same pattern number across all 4 languages
- Same semantic category
- Language-specific watch words and examples

If a pattern is language-specific, document it clearly in the pack's intro text and keep the numbering gap consistent.

## Testing Requirements

- Every new pattern needs at least one `success` example and one `failure` example
- Examples must preserve original meaning — the "after" text should convey the same takeaway as the "before"
- E2E examples in `examples/e2e/` show full pipeline outputs and should be updated when pipeline behavior changes
- Before/after examples in `examples/` serve as the project's test suite

## Output Modes

The skill supports these modes (defined in `.patina.default.yaml`):
- `rewrite` — default; humanizes text
- `diff` — shows what changed and why
- `audit` — detects patterns only
- `score` — AI-likeness score 0-100
- `ouroboros` — iterative self-improvement loop

## Important Constraints

- Do NOT suppress type errors with `as any`, `@ts-ignore`, or `@ts-expect-error`
- Do NOT delete failing tests to make the build pass
- Do NOT commit unless explicitly requested
- Do NOT change the core pipeline unless explicitly requested
- Keep pattern packs auto-discoverable via `patterns/{lang}-*.md` glob
- Do NOT break YAML frontmatter format in pattern packs

## References

- `SKILL.md` — full pipeline specification
- `core/scoring.md` — complete scoring algorithm
- `AGENTS.md` — multi-agent usage guide
- `core/standalone-prompt.md` — agent-agnostic prompt template
