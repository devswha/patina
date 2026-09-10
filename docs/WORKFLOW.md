# Branching, Parallel Work & Release Workflow

A portable git workflow for solo + AI-agent development. This file is
**repo-agnostic** — copy it into any project and adjust only the "Repo specifics"
box below. Agents and humans both follow it.

> **Repo specifics** (edit per project)
> - Default branch: `main`
> - Integration branch: `dev`
> - Feature branch prefix: `bot/*` (agent/automation work), `feat/*` (larger features)
> - Version-bearing files to bump on release: `package.json`, `SKILL.md`, `.patina.default.yaml`, the README version badge, `.claude-plugin/plugin.json`, and the CHANGELOG entry (`npm run release:check` verifies they agree)
> - CI: runs on pull requests to `main` (and `dev` if configured)

`docs/WORKFLOW.md` is the single source of truth for branching, PR/Issue,
review, authority, release, and maintenance policy. The PR template collects
only the fields needed to apply this policy and links back here; it must not
create a second set of thresholds or checker configuration. QA profiles,
status meanings, evidence schema, and cleanup details belong in
[`docs/QA.md`](QA.md).


## CI execution

`.github/workflows/test.yml` grants read-only repository access and bounds each
job to 15 minutes. Pull-request runs share a workflow/PR concurrency group, so
new commits cancel only superseded PR runs; non-PR runs include their unique
`run_id`, so manual dispatches and `dev`/`main` integration pushes remain
independent. Lint and quality use the CI host's Node 24; the test matrix keeps
the Node 18.1.0 smoke check plus full tests on Node 20, Node 22, and floating
`lts/*`. The floating LTS check is retained because protected checks require
the exact `test (lts/*)` name; a fixed Node 24 entry would duplicate the
current LTS (24.20.0), so review fixed coverage when LTS advances. This host
choice does not change the product engine requirement (`>=18.1.0`).


## The branch model

```
bot/<feature>  ──PR──▶  dev  ──release PR──▶  main  ──▶  publish/deploy
 (do the work)        (integrate/stage)     (release)
```

- **`main`** — released/deployed history. Never commit directly to it.
- **`dev`** — integration/staging. Everything converges here first and is verified together before a release.
- **`bot/<feature>` / `feat/<feature>`** — one independently verifiable and
  revertible behavior or contract unit, branched **from `dev`**.

Every PR contains exactly one such unit. Keep implementation, its regression
test, and the contract documentation needed to understand it together. Split
unrelated cleanup, version changes, and generated-file maintenance unless they
are inseparable from that unit. A unit that cannot be tested and reverted on
its own must be re-scoped or receive the explicit exception described below.

`dev` MUST always be at or ahead of `main`. If a hotfix lands directly on `main`,
immediately merge `main` → `dev` so `dev` never drifts behind (a stale `dev` is
the #1 way this workflow rots).


## Feature workflow (single line of work)

```bash
git switch dev && git pull            # start from the latest integration state
git switch -c bot/my-feature          # branch off dev
# ...edit, commit in small logical commits...
# Local preparation ends here. Without separate external-write authority
# naming the actor, channel, scope, and allowed operation, stop here.
# The following branch/PR writes are not implied by an implementation request:
# With that authority recorded, and only then:
git push -u origin bot/my-feature
gh pr create --base dev               # open a PR into dev (CI + review run here)
# after separate merge/deletion authority, approval, and green CI: merge;
# delete the feature branch
```

Rules:
- Commit in small, self-contained commits with clear messages.
- Open the PR as **Draft** while the unit and acceptance criteria are being
  established. Run the cheapest relevant local checks and the normal
  deterministic CI before requesting Ready.
- Keep the branch focused; if it grows beyond one behavior unit, split it.
- Do not treat opening or merging a PR as permission to publish, deploy,
  change account settings, or write to another external system.
- `git push`, `gh pr create`, merge, and remote branch deletion in the example
  require separate explicit external-write authority. Without it, keep the
  branch, commits, and checks local and record the intended command only.


## Parallel work (multiple sessions at once)

The hazard: two sessions sharing **one working directory** or **one branch**
clobber each other's uncommitted changes and interleave commits. The fix is
**git worktrees** — separate folders, separate branches, one shared `.git`.

```bash
# From the primary checkout, spin up an isolated workspace for a parallel task:
git worktree add ../<repo>-featureX -b bot/featureX dev
#   → work in ../<repo>-featureX on bot/featureX, fully isolated on disk

git worktree list          # see all active worktrees
git worktree remove ../<repo>-featureX   # tear down when done; push only with separate authority
```

Rules for parallel work:
1. **One worktree + one branch per parallel session.** Never run two sessions in
   the same directory on the same branch.
2. **Branch each parallel effort from the latest `dev`.** For long-running work,
   periodically `git merge dev` (or rebase) to limit divergence.
3. **Split scope by files.** Parallel efforts touching disjoint file sets almost
   never conflict; overlapping file sets conflict at the `dev` merge.
4. **`dev` is the single convergence point.** Resolve conflicts once, when each
   branch merges into `dev`.

Worktrees isolate checked-out files and branches, not all external state. Before
running a parallel session, identify its worktree/branch and use dedicated
home, `XDG_CONFIG_HOME`, cache, temporary/output directories, ports, and
processes where the tools support them. Reuse an existing injection point
instead of changing shared configuration. Use only approved test credentials;
never copy a personal home or login session into a worktree.

Service-wide quotas, rate limits, and concurrency limits remain intentionally
shared. A per-session home must not be used to bypass them. On exit, remove
only temporary files, ports, and processes owned by the session (for example by
an ownership token or PID recorded at start). Never use broad `pkill`,
`git clean`, `git reset`, or config edits to “clean up” another session.
Changes to shared files such as `package.json`, lockfiles, or orchestration
modules are serialized by the owner and integrated from the latest `dev`.


## PR and Issue policy (P02a)

### Issue requirement and change unit

An Issue is required before work that changes user-observable behavior, a
CLI/API/configuration/installation contract, security or privacy, payment,
deployment or release behavior, a risky design choice, or a behavior change
that needs multiple PRs. Link the Issue with `Refs #...` (or the existing
repository form) and keep one acceptance-criteria list for the whole unit.
Search for an existing Issue or PR before creating another one.

Low-risk exemptions are allowed for a one-PR typo, documentation correction,
or test-only change that does not alter behavior. The PR must state why the
Issue is omitted and still include observable acceptance criteria and a
rollback description. A risky or multi-PR behavior change is never made
Issue-free merely because its diff is small. Security reports and private
source material use an approved private channel, not a public Issue.

### Review budget and evidence

The initial reviewable-diff target is **200-400 lines** of additions plus
deletions. Split the unit when the reviewable diff exceeds **600 lines** or
the reviewable file count exceeds **15 files**. These are review signals, not
an excuse to hide work: report both the raw diff and the reviewable diff, and
list generated output, lockfiles, renames, and pure moves separately while
retaining their raw cost.

The first **10 PRs** using this budget are warnings only. Use their review time,
false alarms, and follow-up regressions to decide whether a blocking policy is
justified. A size exception needs the reason it cannot be split, its validation
and rollback plan, and owner approval; a label by itself is not approval.
Generated evidence includes the source inputs, generator command and version,
reproducibility result, and artifact path or hash. Handwritten Markdown/JSON,
prompts, patterns, and fixtures remain reviewable even when generated files
are present.

Run `npm run pr:check -- --input <fixture.json> --json` for offline evidence,
or `npm run pr:check -- --pr <number> --repo devswha/patina --json` for a
read-only GitHub lookup. Valid size warnings exit 0; incomplete, renamed,
truncated, or otherwise invalid metadata exits 1 and is not docs-only evidence.
Neither command approves a PR, grants a size exception, or replaces required CI.

For every PR, connect evidence to the repository and PR/Issue, the exact
**diff**, **head SHA**, **base SHA**, tested merge SHA (when applicable), and
the tested **tree/build** or artifact. Include the policy/QA profile version,
environment and tool versions, commands, expected and actual results, exit
codes, and any omitted checks. CI-provided evidence may be linked by run ID
instead of copied into the PR, but it must identify the same tree.

Evidence is stale when the head or relevant base changes, when the tested tree
or build differs, or when the policy/profile used for the result changes. Mark
it `stale` and rerun the required checks against the new tree; do not reuse an
old integration result as proof for a new base. Automatic review or QA retries
are bounded to **at most 2 retries** after the initial attempt. Preserve the
first failure and its reason; do not retry indefinitely or turn timeout,
authentication failure, cancellation, or missing evidence into success.

### Draft, Ready, review, and QA

Use this order:

```text
scope + acceptance criteria + isolated worktree
  → Draft PR + cheap targeted checks and normal deterministic CI
  → current size, risk, rollback, and SHA/tree evidence
  → Ready
  → required expensive Codex review and/or browser/execution QA
  → maintainer decision and merge
```

Draft is for collaboration and cheap checks: focused tests, documentation
links, static checks, and the normal CI path appropriate to the change. A PR
becomes Ready only after the unit is independently verifiable/revertible,
required low-cost checks have results, the diff budget or approved exception
is recorded, and head/base/tree evidence is current. Do not spend an
expensive review or QA run on every Draft update.

An author may have at most **2 Ready PRs** open at once. Run at most **1
expensive QA** job/worker concurrently; queue or leave it explicitly
unavailable rather than claiming a pass. QA is required only for the profiles
that the changed surface calls for. Profiles, evidence fields, status values,
flaky-test handling, and resource cleanup are defined in
[`docs/QA.md`](QA.md); do not duplicate those details in a PR.
The sole `not run` result is a documented non-applicability decision with a
specific reason. If an applicable profile is unavailable, record
`inconclusive`; `not run` is never a waiver.

### Codex review requests

Use at most **one Codex code-review request per PR/head/diff**. Whether native
Codex automation runs on Draft, Ready, or a new push is **unknown until P09
confirms the repository's actual native settings**. Do not invent a label,
Action, trigger, or external configuration and do not report one as enabled.
Until that check is complete, no automatic path is assumed; use one explicit,
authorized request path when review is needed. If native settings cannot
enforce the Ready-plus-cheap-CI condition, disable automatic calls and keep
the explicit single path. Never run GitHub Codex, an Action, and Desktop
review against the same diff.

After a finding is fixed, keep it on the same PR and update the evidence.
Automatic fix/review cycles stop after 2 retries; the owner then re-scopes the
unit or decides with the recorded unresolved risk. A review conclusion never
replaces required CI, current SHA evidence, QA, or owner merge authority.

### External-write authority

External writes include creating or editing Issues/PRs/comments/labels,
changing branches or protection, merging, tagging or creating releases,
publishing npm/web/dataset artifacts, deploying, and changing accounts,
settings, credentials, or production data. Each such action requires explicit
authority naming the actor, channel, scope, and allowed operation. An
implementation request, plan approval, or review approval does not imply any
of those permissions. Agents must not create an Issue/PR flood, alter native
settings, or publish/deploy without that authority.


## Release workflow (`dev` → `main`)

```bash
git switch dev && git pull
# 1) confirm the integrated dev tree, included PRs, and current evidence
# 2) bump version in every version-bearing file (see Repo specifics), once
#    in this release preparation change; feature PRs do not bump versions
# 3) run the release verification profile against the release tree
# Local release preparation ends here without separate external-write
# authority naming the actor, channel, scope, and allowed operation.
# With that authority recorded, and only then, create the release PR:
gh pr create --base main --head dev        # release PR: full CI matrix runs
# 4) on green and with explicit merge authority: MERGE (not squash)
# 5) tag or publish only through an explicitly approved channel procedure
git switch dev && git merge main           # keep dev in sync after the release
```

- `dev` is the integration/staging result; a successful merge there closes an
  Issue only when the owner explicitly confirms its acceptance criteria. It
  does **not** mean that users received a release. Do not rely on a `Closes #...`
  keyword in a `dev` PR as that confirmation; record the explicit AC closure
  separately.
- The `dev` → `main` release PR is the documented aggregation exception to the
  one-unit review budget: it must add no new behavior, list the included
  already-reviewed PRs, and carry fresh release-tree and rollback evidence.
- Version changes are **release-only**. Feature and maintenance PRs record
  their semver impact, but the coordinated version-bearing-file bump happens
  once in the release preparation PR after the integrated tree is selected.
  The explicit `npm run release:sync-plugin-versions` pilot copies the root
  package version only into `.claude-plugin/plugin.json` and the matching
  marketplace entry. It does not bump the source version or synchronize the
  other mirrors; `npm run release:check` still validates their agreement.
- **Merge, do not squash, for `dev` → `main`** so a release keeps per-feature
  history. Squash is the default for a small, single-unit `feature → dev` PR;
  use merge when preserving a meaningful commit series is the safer rollback.
- Delivery is reported per channel only after the exact main SHA, artifact or
  deployment identifier, and smoke/evidence are recorded. Integration and
  delivery status are never collapsed into one “done” label.
- npm publication remains **on hold**. This document does not lift that hold,
  grant registry credentials, or authorize a publish. A release may be
  integrated and verified while npm is held; any future publication requires a
  separate, explicit external-write authorization and channel evidence.


## External tools and dependency updates

Treat an external CLI/API as a separate compatibility boundary. Record its
identifier, observed version, required capability/output shape, verification
date, evidence, and status (`verified`, `unverified`, `incompatible`, or
`unavailable`). Authentication failure, quota, timeout, network failure, and
malformed output are reported as such; none is silently converted into a
product-quality pass or an `accepted` result.

Use fixed fixtures for ordinary PR checks. A real external tool or model call
is a separately authorized profile with an explicit tool/model ID, version,
timeout, call limit, cost boundary, and credential path. Do not make it a
hidden prerequisite of deterministic CI, and do not turn a connection check
into a quality claim or a cancelled study. Reuse the existing backend
retry/timeout owner rather than adding a second retry layer.

Review dependency updates as behavior changes: inspect lifecycle scripts,
runtime impact, lockfile installation, and the relevant contract smoke. Keep
general update PRs to at most 2 open at once; security updates are triaged
separately and are never auto-merged solely because they are automated.


## Safety rules (you are not alone in the repo)

- Treat unexpected changes as another session's work. **Never revert, stash,
  reset, or force-push over changes you did not make.**
- **Before pushing a shared branch** (`dev`/`main`), `git fetch` and confirm your
  push only *adds* commits (fast-forward or a clean merge) — never a history
  rewrite. Verify with `git merge-base --is-ancestor origin/<branch> HEAD`.
- Prefer PRs over direct pushes to shared branches so CI + review run.
- Commit or stash before switching branches in a shared working directory.


## Recurring maintenance and ownership (P22)

These are review triggers, not an instruction to register an external scheduler
or open a PR automatically. Every exception (size, flaky test, compatibility
gap, unverified tool, or deferred check) has a named owner, a next-review date,
the condition that closes it, and a link to its existing tracking record.

| Trigger | Owner review | Required record |
|---|---|---|
| Weekly | General dependency updates, due flaky-test isolation, external CLI/API versions, repeated CI/review failures, and the Ready/QA queue | Update or close the existing Issue/PR; keep general update PRs within the limit and preserve first failures |
| Monthly | Temporary branches/flags and document status, old unverified backends, performance trend evidence, stale size/check exceptions, and ownership coverage | Record the decision and next date in the existing tracking record; do not silently extend, delete, or mass-create Issues |
| Before release | Contract/support smoke, exact source/artifact SHA, channel hold or delivery state, and rollback evidence | Release record distinguishes integrated, delivered, held, failed, and unknown channels |

If an owner or review date is missing, the item remains unresolved rather than
becoming an implicit approval. A missed trigger is escalated to the owner; it
does not authorize a new tool, a weaker gate, an unbounded retry, or an
automatic Issue/PR burst.


## Cleanup

- After a branch is merged, delete it (local + remote) only with explicit
  branch-deletion authority. Stale merged branches pile up and hide the
  branches that still matter.
  ```bash
  git branch -d bot/my-feature                 # safe: refuses if not merged
  git push origin --delete bot/my-feature     # requires branch-deletion authority
  git fetch --prune                            # drop stale remote-tracking refs
  ```
- Keep permanent branches only: `main`, `dev`, and genuinely in-flight feature
  branches.


## Quick reference

| Concept | What it is |
|---|---|
| **Branch** | A named line of commit history (a logical timeline / bookmark). |
| **Worktree** | A separate on-disk folder with its own checked-out branch, sharing one `.git`. Enables true parallel work. |
| **PR (Pull Request)** | A GitHub request to merge one branch into another, with review + CI before merging. |

| Task | Command |
|---|---|
| New feature | `git switch dev && git switch -c bot/x` |
| Parallel session | `git worktree add ../repo-x -b bot/x dev` |
| Open PR into dev | external-write authority → `gh pr create --base dev` |
| Release | integrate/verify → release-only version bump → external-write authority → PR to `main` → merge → approved channel step |
| Keep dev synced | `git switch dev && git merge main` |
| Clean merged branch | deletion authority → `git branch -d bot/x && git push origin --delete bot/x` |
