# WARP Notes

Status: internal maintainer note for Warp/agent users. Public usage remains in `README.md`, localized READMEs, and `docs/`.

## What this repo is

Patina is a Claude Code / Codex / Cursor / OpenCode skill plus a standalone Node.js CLI. It detects and rewrites AI writing patterns in Korean, English, Chinese, and Japanese while checking meaning preservation.

## Current architecture reminders

- `SKILL.md`: prompt-based `/patina` orchestrator.
- `src/cli.js` and `bin/patina.js`: standalone CLI surface.
- `patterns/{ko,en,zh,ja}-*.md`: language-specific pattern packs, auto-discovered by prefix.
- `docs/PATTERNS.md` and `docs/PATTERNS-{KO,EN,ZH,JA}.md`: generated/manual references for the pattern packs.
- `core/voice.md`, `profiles/*.md`, and `core/scoring.md`: voice, profile, and scoring references.
- `SKILL-MAX.md` and `patina-max/SKILL.md`: MAX-mode references and installable entrypoint.

## Safe-change rules

- Do not change the core skill pipeline unless explicitly asked.
- When editing patterns, include before/after examples.
- Version-sync changes must update all five version-bearing files named in `AGENTS.md`.
- Run the relevant npm gates before claiming completion.
