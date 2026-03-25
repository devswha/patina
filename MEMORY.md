# MEMORY.md — pointer/index layer

## Current beliefs

- Current priority: keep the hot memory layer small and push durable detail into `memory/`.
- Root memory is for summaries, pointers, and write obligations only.
- Detailed logs belong in `memory/`.

## Quick file map

- Project status: `memory/projects/patina.md`
- Today's execution log: `memory/daily/2026-03-20.md`
- Durable rules: `memory/topics/rules.md`
- Durable lessons: `memory/topics/lessons.md`
- Full subtree guide: `memory/README.md`

## Read this when...

- You need repo/project status -> read `memory/projects/patina.md`
- You need latest execution context -> read today's file in `memory/daily/`
- You are changing workflow policy -> read `memory/topics/rules.md`

## Write obligations

- Daily progress goes to `memory/daily/2026-03-20.md`.
- Project-specific detail goes to `memory/projects/patina.md`.
- Durable lessons get promoted into `memory/topics/lessons.md`.
- `MEMORY.md` only changes when the pointer map or current beliefs change.
