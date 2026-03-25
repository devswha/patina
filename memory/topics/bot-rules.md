# Bot Operating Rules

## Identity
- Name: patina-bot
- Purpose: Autonomous repo maintenance for devswha/patina

## Runtime
- Interactive Discord replies are handled by the OpenClaw gateway
- Component-only Discord bot posts are relayed by `scripts/openclaw-component-bridge.mjs`
- Scheduled autonomous work runs through `scripts/bot.sh` via `openclaw agent`

## Schedule
- Hourly via cron (`0 * * * *`)
- Single-task-per-run (max 1 PR/hour)

## Branch Policy
- Bot works only on `bot/*` branches, never on main
- Orphaned `bot/*` branches are cleaned up at start of each run
- Rebase onto main before creating PR; abandon on conflict

## Quality Gates
- Content changes (patterns, examples, profiles): inline ouroboros scoring, score <= 30
- Config/structural changes (yaml, README, docs, shell scripts): structural validation only
- Version sync: cross-file verification of all 5 version-bearing files

## Merge Policy
- Controlled by `AUTO_MERGE` env var
- Default: `false` (PRs left open for human review during validation period)
- After validation: toggle to `true` for autonomous squash-merge

## Labeling
- All bot PRs carry the `bot` label

## Notifications
- OpenClaw Discord channel `1484400552262762496`
- 4 terminal states: success, failure, timeout, no-tasks
- In-progress updates go through `openclaw message send`

## Safety
- No SKILL.md pipeline logic changes
- Prefer issue titles/labels; avoid issue body content unless needed
- Avoid commands that require human interaction in autonomous runs

## Failure Handling
- Scoring failure (score > 30 after 3 iterations): abandon, clean up branch
- Rebase conflict: abort, delete branch, notify
- Timeout (30m): notify, orphaned branches cleaned next run
