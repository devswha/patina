# Internal Maintainer Notes

These files are maintainer/agent context, not public user documentation. Public docs stay in the root README files and `docs/`; internal notes should not be treated as installation or API contracts.

## Triage of legacy top-level Markdown

| File | Decision | Rationale |
|---|---|---|
| `DESIGN.md` | keep public | Active product/brand source of truth; linked from the README docs list. |
| `WARP.md` | moved here | Warp-specific agent context is useful for maintainers but was stale as public root docs. |
| `AGENTS.md`, `BOOTSTRAP.md`, `USER.md`, `IDENTITY.md`, `SOUL.md`, `MEMORY.md`, `HEARTBEAT.md`, `TOOLS.md` | not tracked in this branch | Runtime/local agent files are intentionally outside the public docs set when absent from git. |

If a future internal note becomes a user-facing contract, move it back into `docs/` or the root and link it from `README.md` with a clear audience.
