# memory/README.md — retrieval guide

## File map

- `daily/YYYY-MM-DD.md` -> chronological work log
- `channels/<channel>.md` -> one lane/channel
- `agents/<agent>.md` -> one agent/operator profile
- `projects/patina.md` -> canonical repo/project state
- `topics/rules.md` -> durable operating rules
- `topics/lessons.md` -> reusable lessons
- `handoffs/YYYY-MM-DD-<slug>.md` -> bounded handoffs
- `archive/YYYY-MM/` -> cold history

## Read by situation

- Need latest execution context -> latest file in `daily/`
- Need canonical project state -> `projects/patina.md`
- Need policy or norms -> `topics/rules.md`

## Naming rules

- Use stable slugs for channels, projects, and agents.
- Keep `MEMORY.md` short; move durable detail into leaf files.
- Archive inactive history instead of bloating the hot path.
