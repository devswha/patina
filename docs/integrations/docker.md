# Docker image

The release job publishes `ghcr.io/devswha/patina` when a maintainer pushes a version tag.

```bash
printf '%s\n' 'Coffee has emerged as a pivotal cultural phenomenon.' \
  | docker run --rm -i -e PATINA_API_KEY ghcr.io/devswha/patina:3.11.0 --lang en --provider openai
```

Tags:

- `ghcr.io/devswha/patina:3.11.0` — version tag from `v3.11.0`.
- `ghcr.io/devswha/patina:latest` — latest release tag.

The image uses `node:18-alpine`. It does **not** include codex, claude, or gemini CLI binaries, and it never carries local login state. For container runs, use an API-backed provider or mount your own authenticated tools explicitly.
