# Branching, PR & Release Workflow

How work moves from a feature branch to a release in this repository. Agents
and humans both follow it. The step-by-step PR checklist lives in
[`CONTRIBUTING.md`](../CONTRIBUTING.md#pr-process); QA profiles and result
statuses live in [`docs/QA.md`](QA.md).

- Default branch: `main`
- Integration branch: `main` (short-lived feature branches; no persistent `dev`)
- Feature branch prefixes: `bot/*` (agent/automation work), `feat/*` (larger features)
- Version-bearing files: `package.json`, `SKILL.md`, `.patina.default.yaml`,
  the README version badge, `.claude-plugin/plugin.json`, and the CHANGELOG
  entry. `npm run release:check` verifies that they agree.

## CI

`.github/workflows/test.yml` grants read-only repository access and bounds each
job to 15 minutes. Pull-request runs share one concurrency group per PR, so a
new commit cancels only the superseded run; pushes and manual dispatches run
independently. Lint and quality run on the CI host's Node 24. The test matrix
runs a Node 18.1.0 smoke check plus full tests on Node 20, 22, and floating
`lts/*`. Branch protection requires the exact `test (lts/*)` name, so the
matrix keeps the floating entry rather than a fixed 24; review fixed coverage
when LTS advances. None of this changes the product engine requirement
(`>=18.1.0`). Browser fixtures run on Node 24 with Chromium and blocked
external browser requests. `release-install` is a separate, explicitly online
npm-registry installation smoke; ordinary unit/e2e tests do not install packages.

## The branch model

```text
bot/<feature> ──PR + CI + review──▶ main
bot/release-X.Y.Z ──version PR────▶ main ──approved tag──▶ npm
```

- **`main`** is the integration branch and must stay deployable. Never commit
  directly to it. A merged feature is not an npm release; tags identify releases.
- **`bot/<feature>` / `feat/<feature>`** branches start at the latest `main` and
  contain one independently reviewable behavior or contract change, its
  regression coverage, and required documentation.
- Each session keeps its own branch and worktree. Concurrent agents do not
  require a persistent integration branch besides `main`.
- Vercel may deploy a `main` merge independently of npm publication. Confirm
  the project's production-branch setting before merging a web-affecting PR;
  keep the deployment ID and rollback target. PR previews validate the candidate.

## Feature workflow

```bash
git fetch origin main
git worktree add ../patina-feature -b bot/my-feature origin/main
# edit and verify in the new worktree
git push -u origin bot/my-feature     # external write: needs authority
gh pr create --draft --base main      # CI runs before marking Ready
```

Run the relevant local checks and CI before marking Ready. Fix review findings
on the same PR, rerun affected checks on its final head, and merge only with
maintainer authority. Split a branch that grows beyond one behavior unit.
Opening or merging a PR never grants permission to publish or change another
external system.

## Parallel work

Two sessions sharing **one working directory** or **one branch** clobber each
other's uncommitted changes and interleave commits. Use **git worktrees**:
separate folders and branches over one shared `.git`.

```bash
git worktree add ../<repo>-featureX -b bot/featureX origin/main
git worktree list
git worktree remove ../<repo>-featureX
```

1. **One worktree and one branch per session.** Never run two sessions in the
   same directory on the same branch.
2. **Branch from the latest `main`**, and merge `origin/main` periodically into
   long-running work.
3. **Split scope by files.** Disjoint file sets almost never conflict.
4. **`main` is the single convergence point.** Resolve conflicts once, when each
   branch merges into it.

Worktrees isolate files and branches, not external state. Give each session its
own home, `XDG_CONFIG_HOME`, cache, temp/output directories, ports, and
processes where the tools allow it, and use only approved test credentials;
never copy a personal home or login session into a worktree. Shared quotas,
rate limits, and concurrency caps stay shared, so a per-session home must not
be used to bypass them. On exit, clean up only what your session owns (by
ownership token or recorded PID). Never use broad `pkill`, `git clean`,
`git reset`, or config edits on another session's state. The owner serializes
changes to shared files such as `package.json`, lockfiles, and orchestration
modules.

## Issues, PR size, and review

**Open an Issue first** for anything that changes user-observable behavior, a
CLI/API/configuration/installation contract, security or privacy, payment,
deployment or release behavior, a risky design choice, or work that needs
several PRs. Search for an existing Issue before creating one, and link it
with `Refs #...`. A one-PR typo, documentation fix, or test-only change may
skip the Issue if the PR says why and still states its acceptance criteria and
rollback. Security reports go through the private channel in
[`SECURITY.md`](../SECURITY.md), not a public Issue.

**PR size.** Aim for 200-400 reviewable lines (additions plus deletions).
Split the unit when the reviewable diff passes 600 lines or 15 files. These
are warnings, not an automatic gate. Report generated output, lockfiles,
renames, and pure moves separately from handwritten changes. A size exception
needs the reason the unit cannot be split, its validation and rollback plan,
and owner approval; a label alone is not approval.

**Evidence.** List the commands you ran and their results. When the head or
base changes, rerun the affected checks instead of reusing an old result.
Automatic review or QA retries stop after two; keep the first failure and its
reason, and never turn a timeout, authentication failure, or cancellation into
a pass.

**Review.** A `bot/*` PR gets one independent, read-only review pass (a
reviewer that did not write the change) plus the full deterministic CI: lint,
unit/e2e, quality, and architecture boundaries. Native Codex GitHub review is
not used in this repository. The `vercel` bot only builds a preview; it reads
no code and is not a review. Record the review verdict and findings in the PR,
fix findings on the same PR, and never run two reviewers against the same
diff. A review never replaces required CI, QA, or the maintainer's merge
decision.

**External writes** include creating or editing Issues, PRs, comments or
labels, pushing or deleting branches, changing protection, merging, tagging,
releasing, publishing to npm or other registries, deploying, and changing
accounts, settings, credentials, or production data. Each needs explicit
authority that names the actor, channel, scope, and operation. An
implementation request, plan approval, or review approval grants none of them.

## Release workflow (version PR → tag)

```bash
git fetch origin main
git worktree add ../patina-release -b bot/release-X.Y.Z origin/main
# update version-bearing files and CHANGELOG once; verify the release tree
git push -u origin bot/release-X.Y.Z          # external write
gh pr create --base main                    # external write
# after CI, review, and authorized merge: tag the exact merged main SHA
# publish only through the approved release.yml channel
```

- Feature PRs record semver impact; version changes belong in a separate
  release-preparation PR. It lists the integrated features, adds no new product
  behavior, and records release-tree and rollback evidence.
- `npm run release:sync-plugin-versions` copies the root version into the plugin
  and marketplace entry; `npm run release:check` validates every mirror.
- Squash small feature or release-preparation PRs. Keep a meaningful commit
  series with a merge when that is safer to revert. There is no `dev` merge-back.
- Close an Issue only when its acceptance criteria are satisfied; merging into
  `main` is not evidence that npm or a container was published.
- Report delivery separately for npm, web, and containers using the exact SHA,
  artifact/deployment ID, and smoke result. Vercel Git deployment may follow
  `main` immediately; npm publication requires an approved tag or manual action.
- npm uses Trusted Publishing (OIDC) from `release.yml`. Every tag/publication
  still requires explicit authority; integrating code never authorizes one.
  See [`docs/integrations/release.md`](integrations/release.md).

## Migration from the former dev branch

Before retiring `dev`, record its tip and confirm it is an ancestor of `main`.
Retarget every open PR, update Dependabot and CI, and stop new work from
branching from `dev`. After the migration PR passes and lands, require `lint`,
`quality`, `browser`, `release-install`, `test (18.1.0)`, `test (20)`, `test (22)`,
and `test (lts/*)` on up-to-date PRs to `main`; enforce the checks for admins,
require PRs and resolved conversations, and forbid force pushes and deletion.
For a single-maintainer repository, do not require an additional human approval
that its sole author cannot supply. The maintainer still reviews the findings.

Only then delete the remote `dev` ref with branch-deletion authority. Do not
switch or remove another session's worktree. Rollback can recreate `dev` at the
recorded tip and restore the old targets through a reviewed PR; no history
rewrite is needed. A repository config file alone does not change GitHub branch
protection or install a GitHub App; verify those external settings separately.

## External tools and dependency updates

Treat an external CLI or API as a separate compatibility boundary. Record its
identifier, observed version, the capability or output shape patina needs, the
verification date, and a status: `verified`, `unverified`, `incompatible`, or
`unavailable`. Report authentication failure, quota, timeout, network failure,
and malformed output as what they are, never as a quality pass.

Ordinary PR checks use fixed fixtures. A real tool or model call is a
separately authorized run with an explicit model ID, version, timeout, call
limit, cost bound, and credential path; it must not become a hidden
prerequisite of deterministic CI. Reuse the existing backend retry/timeout
owner rather than adding a second retry layer.

Review dependency updates as behavior changes: lifecycle scripts, runtime
impact, lockfile installation, and the relevant contract smoke. Keep at most
two general update PRs open; triage security updates separately and never
auto-merge them just because a bot opened them. `.github/dependabot.yml`
targets `main` for npm and github-actions version updates, as do GitHub security
updates. GitHub reads `dependabot.yml` from `main`, so configuration changes
take effect only after they reach `main`.

## Exceptions

Every exception (size, flaky test, compatibility gap, unverified tool, or
deferred check) names an owner, a next-review date, the condition that closes
it, and its tracking record. Review it when that condition appears; there is no
fixed review cadence. An exception without an owner or date stays unresolved,
not approved, and a missed review goes to the owner rather than authorizing a
new tool, a weaker gate, or a burst of automatic Issues or PRs.

## Safety rules (you are not alone in the repo)

- Treat unexpected changes as another session's work. **Never revert, stash,
  reset, or force-push over changes you did not make.**
- **Before pushing a shared branch** (`main`), `git fetch` and confirm the
  push only *adds* commits (fast-forward or a clean merge), never a history
  rewrite: `git merge-base --is-ancestor origin/<branch> HEAD`.
- Prefer PRs over direct pushes to shared branches so CI and review run.
- Commit or stash before switching branches in a shared working directory.

## Cleanup

Delete a merged branch, local and remote, only with branch-deletion authority.
Keep only `main` and branches still in flight.

```bash
git branch -d bot/my-feature                 # refuses if not merged
git push origin --delete bot/my-feature      # needs deletion authority
git fetch --prune                            # drop stale remote-tracking refs
```

## Quick reference

| Task | Command |
|---|---|
| New feature | `git fetch origin main && git worktree add ../repo-x -b bot/x origin/main` |
| Parallel session | `git worktree add ../repo-x -b bot/x origin/main` |
| Open PR into main | external-write authority → `gh pr create --base main` |
| Release | integrate/verify → version bump → external-write authority → PR to `main` → merge → approved channel step |
| Clean merged branch | deletion authority → `git branch -d bot/x && git push origin --delete bot/x` |
