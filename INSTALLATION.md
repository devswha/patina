# Installation Guide for AI Agents

> **Audience:** This file is written for an AI coding agent (Claude Code, Codex CLI, Cursor, OpenCode, Gemini CLI, etc.) executing on the user's machine. If a user asks you to "install patina from https://github.com/devswha/patina.git", follow the steps below verbatim.
>
> **Goal:** Make `/patina` and `/patina-max` available as a skill in the host agent, with no API key required when the host machine has [`codex`](https://github.com/openai/codex) logged in.

**Repository:** `https://github.com/devswha/patina.git`
**Version pinning:** the installer resolves remote `HEAD` once and checks out that concrete commit. For strict reproducibility, set `PATINA_REF=<tag-or-full-sha>`.
**Languages supported:** Korean (ko), English (en), Chinese (zh), Japanese (ja)

---

## Decision Tree (run this first)

Inspect the host before installing. Pick exactly one of the three paths.

| Condition (check in order) | Path |
|---|---|
| `command -v curl` returns success **and** the user has not asked for a specific target | **Path A — One-liner installer** (covers all 4 agent hosts) |
| `curl` is unavailable, **or** the user asked for a single target only | **Path B — Manual install** (clone once, symlink per target) |
| Already installed (`~/.claude/skills/patina/.git` exists) and the user asked to **update** | **Path C — Update existing install** |

Do not mix paths. Do not invent extra steps. If a step fails, stop and surface the error.

---

## Path A — One-liner installer (recommended)

Run this command. It installs into Claude Code, Codex CLI, Cursor, and OpenCode in one shot. The installer resolves remote `HEAD` to a commit SHA before checkout so the local skill does not track a moving `main` branch.

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

For a fully explicit install, pin the checked-out repo ref yourself:

```bash
PATINA_REF=<tag-or-full-sha> \
  curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

**What it does** (so you can explain to the user):
- Clones the repo into `~/.claude/skills/patina` (canonical location).
- Symlinks `patina` and `patina-max` skills into:
  - `~/.claude/skills/` (Claude Code)
  - `~/.codex/skills/` (Codex CLI)
  - `~/.cursor/rules/` (Cursor)
  - `~/.config/opencode/skills/` (OpenCode)
- Checks out a detached commit resolved from `PATINA_REF`, or from remote `HEAD` when `PATINA_REF` is unset.
- Skips any target whose corresponding env var is set to `false` (e.g. `INSTALL_CURSOR=false`).

**Skip a target:**

```bash
INSTALL_CURSOR=false INSTALL_OPCODE=false \
  curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

After this completes, **stop**. Do not run Path B as well.

---

## Path B — Manual install (no curl, or single target)

Use this when `curl` is unavailable or the user explicitly wants to install for one host only.

### Step 1: Clone the canonical copy

```bash
mkdir -p ~/.claude/skills
PATINA_REF="$(git ls-remote https://github.com/devswha/patina.git HEAD | awk 'NR == 1 { print $1 }')"
git clone --depth=1 https://github.com/devswha/patina.git ~/.claude/skills/patina
git -C ~/.claude/skills/patina fetch --depth=1 origin "${PATINA_REF}"
git -C ~/.claude/skills/patina checkout --detach FETCH_HEAD
```

If `~/.claude/skills/patina` already exists but is not a git repo, **stop and ask the user** — do not delete it.

### Step 2: Symlink into the host you need

Pick the row matching the host the user is running you in, and run **only that command**.

| Host | Symlink command |
|---|---|
| Claude Code | (none — Step 1 already placed it under `~/.claude/skills/patina`) |
| Codex CLI | `mkdir -p ~/.codex/skills && ln -snf ~/.claude/skills/patina ~/.codex/skills/patina && ln -snf ~/.claude/skills/patina/patina-max ~/.codex/skills/patina-max` |
| Cursor | `mkdir -p ~/.cursor/rules && ln -snf ~/.claude/skills/patina ~/.cursor/rules/patina && ln -snf ~/.claude/skills/patina/patina-max ~/.cursor/rules/patina-max` |
| OpenCode | `mkdir -p ~/.config/opencode/skills && ln -snf ~/.claude/skills/patina ~/.config/opencode/skills/patina && ln -snf ~/.claude/skills/patina/patina-max ~/.config/opencode/skills/patina-max` |
| Gemini CLI | `mkdir -p ~/.gemini/skills && ln -snf ~/.claude/skills/patina ~/.gemini/skills/patina` |

### Step 3 (optional): Install the standalone Node CLI

Only if the user wants to invoke `patina` from a shell without going through an agent. After the npm package is published, the shortest path is:

```bash
npx patina-cli --lang en input.txt
```

For local development or unpublished commits:

```bash
cd ~/.claude/skills/patina && npm install && npm link
```

Requires Node.js ≥ 18. After this, `patina --help` works as a shell command.

---

## Path C — Update existing install

Use the installer again, or fetch and check out a pinned ref. Do not leave the skill tracking a moving branch.

```bash
PATINA_REF="$(git ls-remote https://github.com/devswha/patina.git HEAD | awk 'NR == 1 { print $1 }')"
git -C ~/.claude/skills/patina fetch --depth=1 origin "${PATINA_REF}"
git -C ~/.claude/skills/patina checkout --detach FETCH_HEAD
```

If the fetch or checkout fails because of local changes, **stop and report to the user**. Do not run `git reset --hard` — that would discard work the user might want.

---

## Verification (run after any path)

Confirm the install succeeded by checking the canonical files exist and the version matches:

```bash
test -f ~/.claude/skills/patina/SKILL.md && \
  grep '^version:' ~/.claude/skills/patina/SKILL.md
```

Expected output: `version: 3.11.0` (or newer).

For each host you installed into, also verify the symlink target:

```bash
# Codex example — adapt path for other hosts
ls -la ~/.codex/skills/patina
# should show:  patina -> /home/<user>/.claude/skills/patina
```

---

## How to use after installation

The user can now invoke patina as a slash command in their agent:

```
/patina --lang en

[paste their text here]
```

Or with a tone preset (v3.10+):

```
/patina --tone narrative

[paste their essay draft]
```

Or via the standalone Node CLI (only if Step 3 of Path B was run):

```
patina --lang ko input.txt
```

Or through Docker after the GHCR release image exists:

```bash
printf '%s\n' 'Coffee has emerged as a pivotal cultural phenomenon.' \
  | docker run --rm -i -e PATINA_API_KEY ghcr.io/devswha/patina:3.11.0 --lang en --provider openai
```

The Docker image intentionally does not bake in codex/claude/gemini CLI binaries or logins. Use API-backed providers inside the container, or mount your own authenticated tooling explicitly.

Free tier: when [`codex`](https://github.com/openai/codex) is installed and logged in, patina works **without** an API key — it dispatches through the codex backend automatically.

For Gemini and Claude API backends, the user can set `GEMINI_API_KEY` or `PATINA_API_KEY` and pass `--backend gemini` / `--backend openai-http` respectively.

---

## Uninstall

```bash
# Remove all symlinks
rm -f ~/.codex/skills/patina ~/.codex/skills/patina-max
rm -f ~/.cursor/rules/patina ~/.cursor/rules/patina-max
rm -f ~/.config/opencode/skills/patina ~/.config/opencode/skills/patina-max
rm -f ~/.gemini/skills/patina

# Remove the canonical clone last
rm -rf ~/.claude/skills/patina

# If the standalone CLI was linked, unlink it
npm unlink -g patina-cli 2>/dev/null || true
```

---

## Troubleshooting (agent diagnostic table)

| Symptom | Likely cause | Action |
|---|---|---|
| `git clone` returns 403/404 | Network blocked, or wrong URL | Verify `https://github.com/devswha/patina.git` is reachable. Do not retry with a different repo URL. |
| `~/.claude/skills/patina exists but is not a git repo` | A previous partial install or unrelated directory | Stop. Ask the user to remove or rename it manually. |
| `git pull --ff-only` fails with `local changes` | User edited the patina source | Stop. Ask before running `git stash` or `git reset`. |
| Slash command `/patina` not recognized after install | Host agent needs a restart, or wrong skill directory | Restart the host agent. Re-run **Verification** above. |
| Standalone `patina` command not found after `npm link` | `npm` global bin not on `PATH` | Tell the user to run `npm bin -g` and add it to `PATH`. |
| `--score` mode says "No API key found" | Codex CLI not logged in and no API key set | Run `codex login`, or set `PATINA_API_KEY`. |

---

## Constraints for the installing agent

To prevent surprises:

- **Do not** install into any directory other than `~/.claude/skills/patina`. Other paths are symlinks pointing back to it.
- **Do not** use `sudo` for any step. patina installs entirely in the user's home directory.
- **Do not** modify the user's shell config (`.bashrc`, `.zshrc`, etc.) automatically. The standalone CLI is opt-in via `npm link` only.
- **Do not** delete or overwrite an existing `~/.claude/skills/patina` directory unless it is a git repo — and even then, only via `git pull`, never `rm -rf` followed by `git clone`.
- **Do** treat any error from a `git`, `mkdir`, `ln`, or `npm` command as fatal. Report and stop.

---

## What patina is (one paragraph for context)

patina detects and rewrites AI writing patterns in Korean, English, Chinese, and Japanese. It runs as a skill in any agent that supports the file-based skill convention, or as a standalone Node.js CLI. Unlike a generic paraphraser, patina is **pattern-based and auditable**: every change is tied to a named pattern from the loaded packs (`ko-content`, `en-style`, etc.), and the original claims are verified to survive the rewrite via a meaning-preservation score (MPS ≥ 70). See `README.md` in the cloned repo for full feature details.
