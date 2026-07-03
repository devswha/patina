# Branching, Parallel Work & Release Workflow

A portable git workflow for solo + AI-agent development. This file is
**repo-agnostic** — copy it into any project and adjust only the "Repo specifics"
box below. Agents and humans both follow it.

> **Repo specifics** (edit per project)
> - Default branch: `main`
> - Integration branch: `dev`
> - Feature branch prefix: `bot/*` (agent/automation work), `feat/*` (larger features)
> - Version-bearing files to bump on release: _list them here_ (e.g. `package.json`, and any files that embed the version)
> - CI: runs on pull requests to `main` (and `dev` if configured)

---

## The branch model

```
bot/<feature>  ──PR──▶  dev  ──release PR──▶  main  ──▶  publish/deploy
 (do the work)        (integrate/stage)     (release)
```

- **`main`** — released/deployed history. Never commit directly to it.
- **`dev`** — integration/staging. Everything converges here first and is verified together before a release.
- **`bot/<feature>` / `feat/<feature>`** — one branch per unit of work, branched **from `dev`**.

`dev` MUST always be at or ahead of `main`. If a hotfix lands directly on `main`,
immediately merge `main` → `dev` so `dev` never drifts behind (a stale `dev` is
the #1 way this workflow rots).

---

## Feature workflow (single line of work)

```bash
git switch dev && git pull            # start from the latest integration state
git switch -c bot/my-feature          # branch off dev
# ...edit, commit in small logical commits...
git push -u origin bot/my-feature
gh pr create --base dev               # open a PR into dev (CI + review run here)
# on approval + green CI: merge; delete the feature branch
```

Rules:
- Commit in small, self-contained commits with clear messages.
- Run the project's tests + lint locally before opening the PR.
- Keep a feature branch focused; if it grows, split it.

---

## Parallel work (multiple sessions at once)

The hazard: two sessions sharing **one working directory** or **one branch**
clobber each other's uncommitted changes and interleave commits. The fix is
**git worktrees** — separate folders, separate branches, one shared `.git`.

```bash
# From the primary checkout, spin up an isolated workspace for a parallel task:
git worktree add ../<repo>-featureX -b bot/featureX dev
#   → work in ../<repo>-featureX on bot/featureX, fully isolated on disk

git worktree list          # see all active worktrees
git worktree remove ../<repo>-featureX   # tear down when done (commit/push first)
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

---

## Release workflow (`dev` → `main`)

```bash
git switch dev && git pull
# 1) bump version in every version-bearing file (see Repo specifics), commit
# 2) run the full test + lint + release gate locally
gh pr create --base main --head dev        # release PR: full CI matrix runs
# 3) on green: MERGE (not squash) so the release keeps per-feature history
# 4) tag the release on main; publish/deploy
git switch dev && git merge main           # keep dev in sync after the release
```

- **Merge, don't squash, for `dev` → `main`.** A release usually bundles several
  features; squashing collapses them into one opaque commit. (Squash is fine for
  small single-feature `feature → dev` PRs.)
- **Version-sync is part of the release**, not an afterthought. Bump every file
  that embeds the version before the release PR.
- **Let CI gate the release** — open it as a PR so the full matrix runs.

---

## Safety rules (you are not alone in the repo)

- Treat unexpected changes as another session's work. **Never revert, stash,
  reset, or force-push over changes you did not make.**
- **Before pushing a shared branch** (`dev`/`main`), `git fetch` and confirm your
  push only *adds* commits (fast-forward or a clean merge) — never a history
  rewrite. Verify with `git merge-base --is-ancestor origin/<branch> HEAD`.
- Prefer PRs over direct pushes to shared branches so CI + review run.
- Commit or stash before switching branches in a shared working directory.

---

## Cleanup

- After a branch is merged, **delete it** (local + remote). Stale merged branches
  pile up and hide the branches that still matter.
  ```bash
  git branch -d bot/my-feature                 # safe: refuses if not merged
  git push origin --delete bot/my-feature
  git fetch --prune                            # drop stale remote-tracking refs
  ```
- Keep permanent branches only: `main`, `dev`, and genuinely in-flight feature
  branches.

---

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
| Open PR into dev | `gh pr create --base dev` |
| Release | version bump → `gh pr create --base main --head dev` → merge → tag |
| Keep dev synced | `git switch dev && git merge main` |
| Clean merged branch | `git branch -d bot/x && git push origin --delete bot/x` |
