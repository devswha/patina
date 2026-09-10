# Release

`release.yml` is the maintainer path for npm distribution artifacts.

<!-- maintenance-lifecycle: npm-token-publishing; owner=repository-maintainer; review=2026-10-09; remove-after=root-and-alias-trusted-publishing-verified -->

The npm `NPM_TOKEN` path remains an intentional hold. The repository maintainer
owns the path and reviews it monthly (next review: **2026-10-09**). Remove the
hold and token path **only after trusted publishing/OIDC has been verified for
both `patina-cli` and `patina-humanizer` in the actual npm accounts**. No
automatic credential deletion, dist-tag change, or hold release is implied by
the workflow.

## Source and web deployment while npm publication is pending

The 8.5.2 source and web hotfix restores the centered landing page and separate examples section. Multilingual copy, optional settings, and rewrite verification stay unchanged. Unreleased dev changes are excluded.
The npm registry still serves 8.3.0; its package version does not establish which
version is deployed on the website. Use a checkout with `npm ci` and
`node bin/patina.js` for commands that have not reached npm yet.

Web deployment normally follows the reviewed `dev` → `main` merge and the existing
Vercel project. The isolated 8.5.2 hotfix starts from released `main`; merge it
back into `dev` immediately. Deployment needs no npm publication or release tag. Keep `dev` in
sync with the resulting `main` history and verify the production version and
rewrite flow after deployment.

While npm publication is pending, do not push a release tag: tags start the npm
publication job. The GitHub Release remains coupled to successful npm publication.
The manual dry run and the separately selected GHCR publication below remain
available without publishing an npm package. When npm publication resumes,
update the availability note here and in the README in the same release change.

## Dry run

```bash
gh workflow run release.yml -f publish=false -f publish_ghcr=false
```

The dry run (`verify` job) runs, in order: `npm run lint`, `npm run release:check` (version metadata across `package.json`, skill files, `.patina.default.yaml`, README, CHANGELOG, plus the retired-concepts scan), `npm test`, `npm run benchmark:report` and `npm run benchmark:compare` with a checked-in `docs/benchmarks` drift check, `npm run dogfood`, `npm run check:no-private-assets`, and `npm pack --dry-run` for both `patina-cli` and the `patina-humanizer` alias package.

It then builds the real root and alias `.tgz` files once with
`scripts/release-artifacts.mjs`. The script records `sourceSHA`, the shared
version, each tarball's SHA-256/SHA-512/SRI integrity, and the packed file
lists in `release-manifest.json`. A clean fixture installs **both tarballs in
one `npm install` command**, then runs `npm ci` from that generated lockfile
dependencies (currently
`js-yaml`/`argparse`) may use the public registry; the lockfile must show
`file:` resolutions and matching integrity for both `patina-cli` and
`patina-humanizer`, with paths resolving to the two supplied tarballs, so
neither package can silently fall back to a registry version. The fixture
verifies that the alias's exact `patina-cli` dependency resolves to the
supplied root tarball and runs both CLI `--version` smoke checks. The verified
directory is uploaded as an artifact named for the commit SHA.
The build output directory and smoke fixture are required to be new or empty;
the script refuses to delete caller-owned files.
The verify job exports the checked manifest version to the publication job.
Manual dispatch from `main` uses that version rather than treating the branch
name as a package version; tag runs also require the tag to match that version.

The build does not invoke the source package's `prepublishOnly` lifecycle: it
packs and later publishes the already-verified tarballs. The ordinary source
`prepublishOnly` safety checks remain unchanged for a direct source publish;
the release path does not use a blanket `--ignore-scripts` bypass.

The local commands are:

```bash
# Choose one fresh output directory for the build:
node scripts/release-artifacts.mjs \
  --output-dir .release-artifacts --source-sha "$GITHUB_SHA"
# `--dry-run` is an explicit spelling of the default no-publish mode.
node scripts/release-artifacts.mjs --dry-run \
  --output-dir .release-artifacts-dry-run --source-sha "$GITHUB_SHA"
# Verify an existing artifact directory without packing source again:
node scripts/release-artifacts.mjs \
  --verify-only --output-dir .release-artifacts \
  --source-sha "$GITHUB_SHA" --version "${GITHUB_REF_NAME#v}"
```

## Publish

Publishing the npm packages is intended for `v*.*.*` tags:

```bash
VERSION=v8.2.1
git tag "$VERSION"
git push origin "$VERSION"
```

Required secret:

- `NPM_TOKEN` for npm provenance publishing.

On a tag push the workflow:

- downloads the verify job's exact tarballs, rechecks `release-manifest.json`
  and both hashes against the tagged SHA, then publishes those paths with the
  explicit `--publish` mode (never re-packs source);
- creates the GitHub Release from the CHANGELOG entry (`github-release` job).

Root and alias publication are tracked separately. A timeout is inspected in
the registry before any retry; an existing exact integrity is treated as the
completed step, while a version with different bytes fails closed. A root
success followed by alias failure therefore retries only the alias. A stale
version cannot promote npm or GitHub `latest`, and the workflow never performs
arbitrary dist-tag changes. A failed GitHub Release step is idempotent: a rerun
edits the existing release without changing its latest marker.
Immediately before either GitHub create or edit, the workflow fetches the
current tag and requires its peeled commit (including annotated tags) to match
the verified source SHA. Creation also uses `--verify-tag` so a deleted tag is
not silently recreated at the default branch. A remote tag can still change
after that check; tag protection and hosted acceptance remain separate gates.

The `github-release` job installs dependencies before importing the local
release helper (the helper uses the pinned `semver` dependency). Its read-only
release checks query the GitHub API endpoints `/releases/tags/{tag}` and
`/releases/latest`; they do not rely on the default limited `gh release list`
page. Only an explicit HTTP 404 is treated as an absent release. Authentication,
network, malformed-response, and `gh` tool failures stop the job rather than
being interpreted as permission to create a duplicate or stale release. A
legacy actionlint version may not recognize the hosted-runner `queue: max`
concurrency key; retain the documented GitHub syntax and treat that validator
result as inconclusive until a current actionlint is available.

Only the publishing job uses the explicit command below; omitting
`--publish` is always a dry run:

```bash
node scripts/release-artifacts.mjs \
  --publish --output-dir .release-artifacts \
  --source-sha "$GITHUB_SHA" --version "${GITHUB_REF_NAME#v}"
```

Release runs use the constant `patina-release-publication` concurrency group,
`cancel-in-progress: false`, and GitHub's `queue: max` setting. GitHub-hosted
queues retain up to the platform's pending-run limit (currently 100); a full
queue cancels additional runs, so this is not an unbounded queue guarantee.
An active publication is never canceled by a newer release request.

Docker / GHCR publishing is decoupled from tag pushes: the `ghcr` job runs only
on `workflow_dispatch` with `publish_ghcr=true`. Manual publication must run from
`main` and publishes `latest`; the current workflow does not emit a semver tag
from that branch (see [docker.md](docker.md)):

```bash
gh workflow run release.yml --ref main -f publish=false -f publish_ghcr=true
```
