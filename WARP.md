# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## What this repo is
This repository is a **Claude Code skill** implemented entirely as Markdown with a plugin architecture inspired by oh-my-zsh. It is the Korean adaptation of [blader/humanizer](https://github.com/blader/humanizer).

The "runtime" is `SKILL.md` (the orchestrator): it reads config, loads pattern packs from `patterns/`, loads a profile from `profiles/`, loads voice guidelines from `core/`, and processes text.

## Architecture (oh-my-zsh parallel)

| oh-my-zsh | oh-my-humanizer |
|-----------|-----------------|
| `.zshrc` | `.humanizer.default.yaml` |
| `plugins/` | `patterns/` |
| `themes/` | `profiles/` |
| `custom/plugins/` | `custom/patterns/` |

## Key files (and how they relate)

- `SKILL.md`
  - The orchestrator skill definition.
  - Starts with YAML frontmatter (`---` … `---`) containing `name`, `version`, `description`, and `allowed-tools`.
  - After the frontmatter: config loading → pattern loading → profile loading → voice loading → text processing pipeline.

- `.humanizer.default.yaml`
  - Default configuration: which patterns to load, which profile, output mode, blocklist/allowlist.

- `core/voice.md`
  - Voice and personality guidelines. Extracted from the original monolithic SKILL.md.

- `patterns/*.md`
  - Pattern packs. Each file has YAML frontmatter (pack name, language, pattern count) and contains the actual pattern definitions with before/after examples.
  - `ko-structure.md` (patterns 25-28, Phase 1), `ko-content.md` (patterns 1-6), `ko-language.md` (7-12), `ko-style.md` (13-18), `ko-communication.md` (19-21), `ko-filler.md` (22-24).

- `profiles/*.md`
  - Writing style profiles. Each has YAML frontmatter and tone/priority guidelines.
  - `default.md` is the base profile.

- `custom/`
  - User extension directory (.gitignore'd). `custom/patterns/` and `custom/profiles/` for user-added content.

- `README.md`
  - Installation, usage, and pattern overview (in English).

- `LICENSE` - MIT license.
- `.gitignore` - Excludes `.omc/`, `custom/`, and editor temp files.

## Common commands
### Install the skill into Claude Code
Recommended (clone directly into Claude Code skills directory):
```bash
mkdir -p ~/.claude/skills
git clone https://github.com/devswha/oh-my-humanizer.git ~/.claude/skills/humanizer-kr
```

Manual install/update:
```bash
mkdir -p ~/.claude/skills/humanizer-kr
cp -r SKILL.md .humanizer.default.yaml core/ patterns/ profiles/ ~/.claude/skills/humanizer-kr/
```

## How to "run" it (Claude Code)
Invoke the skill:
- `/humanizer-kr` then paste Korean text
- `/humanizer-kr --profile blog` for blog-style output
- `/humanizer-kr --audit` for detection-only mode

## Making changes safely

### Versioning (keep in sync)
- `SKILL.md` has a `version:` field in its YAML frontmatter.
- `.humanizer.default.yaml` has a `version:` field.
- `README.md` has a "Version History" section.

If you bump the version, update all three.

### Editing patterns
- Pattern packs are in `patterns/*.md`. Each has its own YAML frontmatter with `patterns:` count.
- Keep pattern numbering stable across packs.
- All examples should be in Korean with realistic before/after pairs.

### Editing the orchestrator (`SKILL.md`)
- The orchestrator references files by Glob/Read. If you rename or move files, update the orchestrator.
- Preserve valid YAML frontmatter formatting.

### Adding new pattern packs
- Create a new `.md` file in `patterns/` with the standard frontmatter format.
- Add the pack name to `.humanizer.default.yaml` under `patterns:`.

### Adding new profiles
- Create a new `.md` file in `profiles/` with profile frontmatter.
- Users select profiles via `--profile <name>` or by editing `.humanizer.default.yaml`.

### Documenting non-obvious fixes
If you change the prompt to handle a tricky failure mode, add a short note to `README.md`'s version history.
