# Branching, PR & Release Workflow

How work moves from a feature branch to a release in this repository. Agents
and humans both follow it. The step-by-step PR checklist lives in
[`CONTRIBUTING.md`](../CONTRIBUTING.md#pr-process); QA profiles and result
statuses live in [`docs/QA.md`](QA.md).

- Default branch: `main`
- Integration branch: `dev`
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
(`>=18.1.0`).

## The branch model

```
bot/<feature>  ──PR──▶  dev  ──release PR──▶  main  ──▶  publish/deploy
 (do the work)        (integrate/stage)     (release)
```

- **`main`** — released/deployed history. Never commit directly to it.
- **`dev`** — integration/staging. Everything converges here first and is verified together before a release.
- **`bot/<feature>` / `feat/<feature>`** — one independently verifiable and
  revertible behavior or contract unit, branched **from `dev`**.

Every PR carries exactly one such unit, together with its regression test and
the contract documentation needed to understand it. Split out unrelated
cleanup, version changes, and generated-file maintenance unless they are
inseparable from the unit.

`dev` MUST always be at or ahead of `main`. If a hotfix lands directly on
`main`, merge `main` → `dev` immediately; a stale `dev` is the most common way
this workflow rots.

## Feature workflow

```bash
git switch dev && git pull            # start from the latest integration state
git switch -c bot/my-feature          # branch off dev
# ...edit, commit in small logical commits...
git push -u origin bot/my-feature     # external write: needs explicit authority
gh pr create --base dev               # CI + review run here
```

- Commit in small, self-contained commits with clear messages.
- Open the PR as **Draft** while scope and acceptance criteria settle. Run the
  cheapest relevant local checks and the normal CI before marking it Ready.
- If the branch grows beyond one behavior unit, split it.
- Opening or merging a PR never grants permission to publish, deploy, change
  account settings, or write to another external system.

## Parallel work

Two sessions sharing **one working directory** or **one branch** clobber each
other's uncommitted changes and interleave commits. Use **git worktrees**:
separate folders and branches over one shared `.git`.

```bash
git worktree add ../<repo>-featureX -b bot/featureX dev
git worktree list
git worktree remove ../<repo>-featureX
```

1. **One worktree and one branch per session.** Never run two sessions in the
   same directory on the same branch.
2. **Branch from the latest `dev`**, and merge `dev` periodically into
   long-running work.
3. **Split scope by files.** Disjoint file sets almost never conflict.
4. **`dev` is the single convergence point.** Resolve conflicts once, when each
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

## Release workflow (`dev` → `main`)

```bash
git switch dev && git pull
# 1) confirm the integrated dev tree and the PRs it includes
# 2) bump every version-bearing file once, in this release change
# 3) run the release checks against the release tree
gh pr create --base main --head dev        # release PR (external write)
# 4) on green CI and with merge authority: MERGE (not squash)
# 5) tag or publish only through an approved channel procedure
git switch dev && git merge main           # keep dev in sync
```

- A merge into `dev` does not mean users received a release. It closes an
  Issue only when the owner confirms its acceptance criteria; a `Closes #...`
  keyword in a `dev` PR is not that confirmation.
- The release PR is the one aggregation exception to the size guidance. It adds
  no new behavior, lists the already-reviewed PRs it includes, and carries
  release-tree and rollback evidence.
- Version changes are release-only. Feature PRs record their semver impact;
  the release PR bumps the version-bearing files once.
  `npm run release:sync-plugin-versions` copies the root package version into
  `.claude-plugin/plugin.json` and the matching marketplace entry only;
  `npm run release:check` still validates every mirror.
- **Merge, do not squash, for `dev` → `main`**, so a release keeps per-feature
  history. Squash is the default for a small `feature → dev` PR; merge when a
  meaningful commit series is the safer rollback.
- Report delivery per channel (npm, web, container) only after the exact
  `main` SHA, artifact or deployment ID, and smoke result are recorded.
- npm publication runs through Trusted Publishing (OIDC) from `release.yml`
  ([`docs/integrations/release.md`](integrations/release.md)). It is possible
  but never automatic: no session may publish, tag, or deploy on its own
  initiative, and each publication needs its own explicit authorization. A
  release may be integrated and verified without being published.

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
targets `dev` for npm and github-actions version updates. GitHub raises
security updates against the default branch (`main`); when one lands there,
merge `main` → `dev` immediately. GitHub reads `dependabot.yml` from `main`,
so a change to it takes effect only after it reaches `main`.

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
- **Before pushing a shared branch** (`dev`/`main`), `git fetch` and confirm the
  push only *adds* commits (fast-forward or a clean merge), never a history
  rewrite: `git merge-base --is-ancestor origin/<branch> HEAD`.
- Prefer PRs over direct pushes to shared branches so CI and review run.
- Commit or stash before switching branches in a shared working directory.

## Cleanup

Delete a merged branch, local and remote, only with branch-deletion authority.
Keep only `main`, `dev`, and branches still in flight.

```bash
git branch -d bot/my-feature                 # refuses if not merged
git push origin --delete bot/my-feature      # needs deletion authority
git fetch --prune                            # drop stale remote-tracking refs
```

## Quick reference

| Task | Command |
|---|---|
| New feature | `git switch dev && git switch -c bot/x` |
| Parallel session | `git worktree add ../repo-x -b bot/x dev` |
| Open PR into dev | external-write authority → `gh pr create --base dev` |
| Release | integrate/verify → version bump → external-write authority → PR to `main` → merge → approved channel step |
| Keep dev synced | `git switch dev && git merge main` |
| Clean merged branch | deletion authority → `git branch -d bot/x && git push origin --delete bot/x` |
