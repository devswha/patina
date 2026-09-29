# Development workflow

Patina uses `main` for integration and short-lived branches for changes.
The examples below cover common Git, CI, review, and release operations.

## Branches and pull requests

```bash
git fetch origin main
git switch -c bot/my-change origin/main
# edit and run the checks relevant to the change
git push -u origin bot/my-change
gh pr create --base main
```

A separate worktree is useful when another session is using the checkout:

```bash
git worktree add ../patina-change -b bot/my-change origin/main
```

Issues can track work that benefits from discussion or a longer history.
PR descriptions explain the resulting behavior and relevant validation.
Scope, commit structure, and review depth depend on the change.

## CI

`.github/workflows/test.yml` runs on pushes and PRs to `main`, plus manual
requests. It has read-only repository permissions and 15-minute job timeouts.
New PR commits cancel superseded runs for the same PR.

| Job | Coverage |
|---|---|
| `lint` | Syntax, ESLint, TypeScript, CSpell, and architecture checks on Node 24 |
| `test (18.1.0)` | Minimum-engine syntax and benchmark smoke |
| `test (20)`, `test (22)`, `test (lts/*)` | Unit/e2e fixtures with npm offline |
| `quality` | Release metadata, package paths, benchmark drift, public-doc checks, and Redis regression |
| `browser` | Chromium with local transport fixtures on Node 24 |
| `release-install` | Public-registry installation of local root/alias tarballs on Node 24 |

The product engine range is `>=18.1.0`. GitHub branch protection is configured
in repository settings; check names come from the workflow's job IDs and matrix.

## Reviews

`.coderabbit.yaml` configures CodeRabbit's automated review of Ready PRs.
The GitHub App connection is managed in GitHub. The configuration uses advisory
reviews; PR checks and review comments show what actually ran and what remains
to investigate. A local config file does not install the App.

Other review approaches are available when they help investigate a change.

## Releases and deployment

Feature integration and package publication are separate operations. The
version source is `package.json`; `npm run release:check` checks its mirrors,
and `npm run release:sync-plugin-versions` updates plugin version mirrors.

A typical release updates the version-bearing files and CHANGELOG in a PR,
then tags the merged revision. `release.yml` publishes npm packages on
`v*.*.*` tags using Trusted Publishing (OIDC). It also supports manual runs:

```bash
gh workflow run release.yml --ref main -f publish=false -f publish_ghcr=false
```

That command builds and verifies release artifacts without publishing them.
The npm, GitHub Release, and container paths are described in
[the release integration](integrations/release.md).

Vercel can deploy a `main` merge independently of npm publication. Its project
settings identify the production branch, and deployment history contains the
source SHA and previous deployments for rollback.

## Retiring dev

After moving open PRs and automation to `main`, compare the current branch tips:

```bash
git fetch origin main dev
git rev-parse origin/dev
git merge-base --is-ancestor origin/dev origin/main
```

The ancestor check identifies whether `dev` contains work absent from `main`.
Once migration is complete, the remote ref can be removed with
`git push origin --delete dev`. A retained tip can recreate it if needed.
This operation does not switch local checkouts or remove worktrees.

## Branch cleanup

```bash
git branch -d bot/my-change
git push origin --delete bot/my-change
git fetch --prune
```

`git branch -d` checks whether the local branch has been merged.
