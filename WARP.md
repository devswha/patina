# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## What this repo is
This repository is a **Claude Code skill** implemented entirely as Markdown with a plugin architecture inspired by oh-my-zsh. It supports **Korean** (28 patterns) and **English** (24 patterns) AI writing pattern detection, based on [blader/humanizer](https://github.com/blader/humanizer).

The "runtime" is `SKILL.md` (the orchestrator): it reads config, auto-discovers language-specific pattern packs from `patterns/`, loads a profile from `profiles/`, loads voice guidelines from `core/`, and processes text.

## Architecture (oh-my-zsh parallel)

| oh-my-zsh | patina |
|-----------|--------|
| `.zshrc` | `.patina.default.yaml` |
| `plugins/` | `patterns/` |
| `themes/` | `profiles/` |
| `custom/plugins/` | `custom/patterns/` |

## Key files (and how they relate)

- `SKILL.md`
  - The orchestrator skill definition.
  - Starts with YAML frontmatter (`---` ... `---`) containing `name`, `version`, `description`, and `allowed-tools`.
  - After the frontmatter: config loading -> `--lang` flag parsing -> pattern auto-discovery -> profile loading -> voice loading -> text processing pipeline.

- `SKILL-MAX.md`
  - Source/reference doc for the MAX mode workflow.

- `patina-max/SKILL.md`
  - Installable MAX mode skill entrypoint exposed as `/patina-max`.
  - Uses `claude -p` / `gemini -p` for Claude/Gemini and `codex exec` for Codex.
  - Scores each result and auto-selects the best (lowest AI score) output.

- `.patina.default.yaml`
  - Default configuration: language, profile, output mode, blocklist/allowlist. MAX mode model selection (`max-models` field).
  - Pattern loading uses auto-discovery (`Glob patterns/{lang}-*.md`), not the `patterns` list (which is informational).

- `core/voice.md`
  - Voice and personality guidelines. Extracted from the original monolithic SKILL.md.

- `patterns/*.md`
  - Pattern packs. Each file has YAML frontmatter (pack name, language, pattern count) and contains the actual pattern definitions with before/after examples.
  - Korean: `ko-structure.md` (patterns 25-28, Phase 1), `ko-content.md` (1-6), `ko-language.md` (7-12), `ko-style.md` (13-18), `ko-communication.md` (19-21), `ko-filler.md` (22-24).
  - English: `en-structure.md` (placeholder, 0 patterns), `en-content.md` (1-6), `en-language.md` (7-12), `en-style.md` (13-18), `en-communication.md` (19-21), `en-filler.md` (22-24).

- `profiles/*.md`
  - Writing style profiles. Each has YAML frontmatter and tone/priority guidelines.
  - `default.md` is the base profile.

- `custom/`
  - User extension directory (.gitignore'd). `custom/patterns/` and `custom/profiles/` for user-added content.

- `README.md`
  - Installation, usage, and pattern overview (in English).

- `LICENSE` - MIT license.
- `.gitignore` - Excludes `.omc/`, `.omx/`, `custom/`, and editor temp files.

## Common commands
### Install the skill into Claude Code
Recommended (clone directly into Claude Code skills directory):
```bash
mkdir -p ~/.claude/skills
git clone https://github.com/devswha/patina.git ~/.claude/skills/patina
ln -snf ~/.claude/skills/patina/patina-max ~/.claude/skills/patina-max
```

Manual install/update:
```bash
mkdir -p ~/.claude/skills/patina
cp -a SKILL.md .patina.default.yaml core/ patterns/ profiles/ patina-max/ ~/.claude/skills/patina/
ln -snf ~/.claude/skills/patina/patina-max ~/.claude/skills/patina-max
```

## How to "run" it (Claude Code)
Invoke the skill:
- `/patina` then paste Korean text (default language: ko)
- `/patina --lang en` then paste English text
- `/patina --profile blog` for blog-style output
- `/patina --audit` for detection-only mode
- `/patina-max` then paste text (install `~/.claude/skills/patina-max` symlink first)
- `/patina-max --models claude,gemini,codex` to specify models

## Making changes safely

### Versioning (keep in sync)
- `SKILL.md` has a `version:` field in its YAML frontmatter.
- `SKILL-MAX.md` has a `version:` field in its YAML frontmatter.
- `patina-max/SKILL.md` has a `version:` field in its YAML frontmatter.
- `.patina.default.yaml` has a `version:` field.
- `README.md` has a "Version History" section.

If you bump the version, update all five.

### Editing patterns
- Pattern packs are in `patterns/*.md`. Each has its own YAML frontmatter with `patterns:` count.
- Keep pattern numbering stable across packs.
- Korean examples in `ko-*.md`, English examples in `en-*.md`.

### Adding a new language
1. Create `{lang}-*.md` pattern files in `patterns/` with appropriate frontmatter (`language: {lang}`).
2. Pattern loading auto-discovers via `Glob patterns/{lang}-*.md` -- no config changes needed.
3. Update README.md with the new language's pattern table.

### Editing the orchestrator (`SKILL.md`)
- The orchestrator references files by Glob/Read. If you rename or move files, update the orchestrator.
- Preserve valid YAML frontmatter formatting.

### Adding new pattern packs
- Create a new `.md` file in `patterns/` with the standard frontmatter format.
- Pattern packs are auto-discovered by language prefix -- no need to update `.patina.default.yaml`.

### Adding new profiles
- Create a new `.md` file in `profiles/` with profile frontmatter.
- Users select profiles via `--profile <name>` or by editing `.patina.default.yaml`.

### Documenting non-obvious fixes
If you change the prompt to handle a tricky failure mode, add a short note to `README.md`'s version history.
