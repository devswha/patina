# Docker image

A public image is published at `ghcr.io/devswha/patina` (tag `latest`, verified
2026-09-02). Publishing is **manual**: the `ghcr` job in `release.yml` runs only
on `workflow_dispatch` with `publish_ghcr=true`. Tag pushes publish npm and the GitHub Release
but do not rebuild the image, so `latest` can lag the npm version. Manual
publication is accepted by the workflow from `main` and publishes `latest`;
the current workflow does not emit a separate version tag from that branch.

```bash
docker pull ghcr.io/devswha/patina:latest
printf '%s\n' 'Coffee has emerged as a pivotal cultural phenomenon.' \
  | docker run --rm -i -e PATINA_API_KEY ghcr.io/devswha/patina:latest --lang en --provider openai
```

To build locally instead (for example to match the exact npm version):

```bash
docker build -t patina:local .
printf '%s\n' 'Coffee has emerged as a pivotal cultural phenomenon.' \
  | docker run --rm -i -e PATINA_API_KEY patina:local --lang en --provider openai
```

Maintainers publish a new image with:

```bash
gh workflow run release.yml --ref main -f publish=false -f publish_ghcr=true
```

The image uses `node:22-alpine`. It does **not** include codex, claude, or gemini CLI binaries, and it never carries local login state. For container runs, use an API-backed provider or mount your own authenticated tools explicitly.
