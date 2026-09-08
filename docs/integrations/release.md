# Release

`release.yml` is the maintainer path for npm distribution artifacts.

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

- publishes `patina-cli` and the `patina-humanizer` alias to npm (`npm` job);
- creates the GitHub Release from the CHANGELOG entry (`github-release` job).

Docker / GHCR publishing is decoupled from tag pushes: the `ghcr` job runs only
on `workflow_dispatch` with `publish_ghcr=true`. Manual publication must run from
`main` and publishes `latest`; the current workflow does not emit a semver tag
from that branch (see [docker.md](docker.md)):

```bash
gh workflow run release.yml --ref main -f publish=false -f publish_ghcr=true
```
