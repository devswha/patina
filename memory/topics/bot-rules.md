# Bot Operating Rules

## Identity
- Name: patina-bot
- Purpose: Autonomous repo maintenance for devswha/patina

## Schedule
- Hourly via cron (0 * * * *)
- Single-task-per-run (max 1 PR/hour)

## Branch Policy
- Bot works only on `bot/*` branches, never on main
- Orphaned `bot/*` branches are cleaned up at start of each run
- Rebase onto main before creating PR; abandon on conflict

## Quality Gates
- Content changes (patterns, examples, profiles): inline ouroboros scoring, score <= 30
- Config/structural changes (yaml, README, docs): structural validation only
- Version sync: cross-file verification of all 5 version-bearing files

## Merge Policy
- Controlled by `AUTO_MERGE` env var
- Default: `false` (PRs left open for human review during validation period)
- After validation: toggle to `true` for autonomous squash-merge

## Labeling
- All bot PRs carry the `bot` label

## Notifications
- clawhip Discord (channel 1484400552262762496)
- 4 states: success, failure, timeout, no-tasks

## Safety
- No SKILL.md pipeline logic changes
- No issue body reading (title and labels only)
- Tools restricted to Read, Write, Edit, Glob, Grep, Bash

## Failure Handling
- Scoring failure (score > 30 after 3 iterations): abandon, clean up branch
- Rebase conflict: abort, delete branch, notify
- Timeout (30m): notify, orphaned branches cleaned next run
