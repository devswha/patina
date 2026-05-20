# Harness Hardening Audit

Status: internal maintainer audit for Wave 3 backlog hardening. This is not user-facing CLI documentation and does not enable automation.
Date: 2026-05-21 KST / 2026-05-20 UTC.
Related local inputs: `.workclaw/harness-hardening-checklist.md`, `memory/topics/bot-rules.md`, `memory/topics/bot-learnings.md`.

## Scope and evidence

This audit intentionally uses only safe repo-local checks. It does not touch credentials, cron, the runtime gateway, Discord, or live bot services.

Evidence gathered:

- `git ls-files ops .workclaw memory/topics` returns no tracked files for those paths.
- Local `.workclaw/` exists but is ignored by `.gitignore` and marked as human-managed.
- `.gitignore` ignores `artifacts/harness/*/`, `.env`, `.env.*`, `.workclaw/`, and `memory/`.
- `gh pr list --state open --label bot` returned no open bot PRs at audit time.
- `git ls-remote --heads origin 'refs/heads/bot/*'` returned one orphan-like remote branch: `bot/live-quality-regression-workflow`.

Because the runtime harness files named by local memory (`ops/harness.sh`, `ops/bot.sh`, `ops/runtime-cli.sh`, `ops/component-bridge.mjs`) are not tracked in the current repository checkout, most runtime hardening items cannot be proven or fixed in a tracked PR without first reintroducing or deliberately documenting those local ops files.

## Critical checklist result

| Item | Result | Evidence / blocker |
|---|---|---|
| C1: no env dump in `harness.sh` logs | Blocked | No tracked `ops/harness.sh` exists to inspect. Needs local runtime script access. |
| C1: `artifacts/harness/*/` ignored | Pass | `.gitignore` contains `artifacts/harness/*/`, so run artifacts stay untracked by default. |
| C1: token/key filtering in agent output | Blocked | No tracked generator/evaluator/harness implementation exists to inspect. Needs local runtime scripts or a tracked redaction layer. |
| C2: Planner prefers issue titles/labels | Partially covered | `AGENTS.md` and `memory/topics/bot-rules.md` require titles/labels first, but the executable planner prompt is not tracked. |
| C2: Generator avoids inserting external input as code | Blocked | Needs tracked generator prompt or runtime artifact review. Current repo has only local `.workclaw/allowed-scope.md`. |
| C2: denylist automation via `allowed-scope.md` | Blocked | `.workclaw/allowed-scope.md` exists locally but is ignored and not enforced by tracked tests or CI. |
| C3: `/tmp/patina-bot.lock` flock behavior | Blocked | No tracked harness or cron entry exists to run a safe overlapping invocation test. |
| C3: second cron run exits gracefully | Blocked | Requires runtime/cron surface and the missing harness script. |

## Important checklist result

| Item | Result | Evidence / blocker |
|---|---|---|
| I1: trap returns to `main` on every failure path | Blocked | Missing tracked harness implementation. |
| I1: local + remote orphan branch cleanup | Blocked | One remote `bot/*` branch exists without an open bot PR; deleting it is a state-changing operation and should be done only after owner confirmation or a harness cleanup run. |
| I1: `result.json` on all exits | Blocked | Missing tracked harness implementation. |
| I2: per-agent 10 minute timeout | Blocked | Missing tracked harness implementation. |
| I2: timeout kills child processes | Blocked | Missing tracked harness implementation. |
| I2: timeout reason in `result.json` | Blocked | Missing tracked harness implementation. |
| I3: scoring sample exercises changed pattern | Deferred | This needs a content-change harness fixture design; not needed for the current docs-only campaign work. |
| I3: scoring result copied into `review.md` | Blocked | Missing tracked evaluator/review writer implementation. |
| I3: score threshold periodic review | Covered elsewhere | `process/pattern-freshness.md` now defines quarterly freshness and promotion gates; harness-specific threshold review still needs runtime integration. |
| I4: notification fallback | Blocked | Runtime/Discord gateway access and local notification scripts are required. |
| I4: consecutive notification failure escalation | Blocked | Requires runtime state and notification history. |
| I4: standardized notification format | Blocked | Requires the missing notification sender implementation. |

## Safe repo-local hardening applied

No runtime automation was enabled. The safe tracked change is this audit plus the internal docs index update, so future maintainers do not confuse local `.workclaw` notes with proven tracked automation.

The existing repository already has one important hardening property: harness artifacts and local secrets are ignored. That protects accidental commits while the harness remains local/disabled.

## Activation blockers

Before reactivating or expanding autonomous bot runs, resolve these blockers in a dedicated `bot/*` branch or in the local runtime repository where the files actually live:

1. Inspect or restore the runtime harness implementation (`ops/harness.sh`, `ops/bot.sh`, runtime CLI wrapper, component bridge) and run shell/Node syntax checks.
2. Run a minimal-environment cron simulation with `env -i` so PATH and notification failures do not silently skip work.
3. Run an overlapping invocation test that proves `/tmp/patina-bot.lock` exits cleanly on the second process.
4. Add or verify output redaction for secrets before writing `artifacts/harness/*/review.md`, `diff.patch`, or notifications.
5. Prove every terminal path writes `result.json` with status, reason, run id, branch, PR number when present, and duration.
6. Verify timeout cleanup kills child agent processes and records the timeout reason.
7. Decide whether to delete or preserve stale remote branch `bot/live-quality-regression-workflow`.
8. Run a dry-run harness pass that creates artifacts but does not push or open a PR.

Until those are done, keep `AUTO_MERGE=false` and treat the autonomous harness as inactive/local-only.
