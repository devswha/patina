# Release

`release.yml` is the maintainer path for npm distribution artifacts.

## Dry run

```bash
gh workflow run release.yml -f publish=false -f publish_ghcr=false
```

The dry run verifies:

- version metadata across `package.json`, skill files, `.patina.default.yaml`, README, and CHANGELOG;
- unit/e2e tests;
- benchmark report schema;
- dogfood docs score;
- `npm pack --dry-run` for both `patina-cli` and the `patina-humanizer` alias package.

## Publish

Publishing the npm packages is intended for `v*.*.*` tags:

```bash
git tag v3.11.0
git push origin v3.11.0
```

Required secret:

- `NPM_TOKEN` for npm provenance publishing.

The publish job uploads:

- `patina-cli` to npm;
- `patina-humanizer` alias to npm.

Docker / GHCR publishing is intentionally decoupled from npm releases while
the container distribution issue is still open. Maintainers can run the
experimental image path manually after npm verification:

```bash
gh workflow run release.yml --ref v3.11.0 -f publish=false -f publish_ghcr=true
```
