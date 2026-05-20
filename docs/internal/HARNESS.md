# Harness Notes

Status: internal maintainer note. This is not public installation guidance.

## Current stance

- Patina is primarily a Markdown skill plus a Node.js CLI.
- Use specification-first review for changes that touch pattern definitions, scoring logic, or meaning-preservation behavior.
- Keep the core skill pipeline stable unless the change explicitly targets pipeline behavior.
- For docs-only waves, prefer `docs-review` evidence and the standard npm verification gates.

## Historical context

Older agent notes referenced an OMC/Ouroboros harness as the primary working lane. The current workspace uses the repo's active Codex/OMX runtime instructions from `AGENTS.md` and the bootstrap files instead. Treat older harness-specific routing as historical unless it is reintroduced in active automation.
