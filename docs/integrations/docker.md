# Docker image

The npm release job does not publish Docker images automatically. GHCR
publishing is tracked separately so the first npm release can stay npm-only.

Until the image is published, build the local image:

```bash
docker build -t patina:local .
printf '%s\n' 'Coffee has emerged as a pivotal cultural phenomenon.' \
  | docker run --rm -i -e PATINA_API_KEY patina:local --lang en --provider openai
```

Planned tags after the GHCR publishing issue is closed:

- `ghcr.io/devswha/patina:<version>` — version tag from `v<version>`.
- `ghcr.io/devswha/patina:latest` — latest release tag.

The image uses `node:18-alpine`. It does **not** include codex, claude, or gemini CLI binaries, and it never carries local login state. For container runs, use an API-backed provider or mount your own authenticated tools explicitly.
