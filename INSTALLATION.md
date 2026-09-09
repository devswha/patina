# Installation Guide for AI Agents

> **Audience:** This file is written for an AI coding agent (Claude Code, Codex CLI, Cursor, OpenCode, Gemini CLI, etc.) executing on the user's machine. If a user asks you to "install patina from https://github.com/devswha/patina.git", follow the steps below verbatim.
>
> **Goal:** Make `/patina` available as a skill in the host agent, and make the local CLI runtime actually start. The installer never selects, checks, or authenticates a backend; backend login stays with the user.

**Repository:** `https://github.com/devswha/patina.git`
**Version pinning:** the installer resolves remote `HEAD` once and checks out that concrete commit. For strict reproducibility, set `PATINA_REF=<tag-or-full-sha>`.
**Languages supported:** Korean (ko), English (en), Chinese (zh), Japanese (ja)

---

## Path 0 — Claude Code plugin marketplace (interactive, no clone)

If the user is in an **interactive Claude Code session**, the simplest install is the plugin marketplace — no git clone, and updates flow through `/plugin`:

```text
/plugin marketplace add devswha/patina
/plugin install patina@patina
```

After installing, turn on automatic updates — third-party marketplaces ship with auto-update **disabled** by default, so without this step the plugin silently stays on the installed version:

```text
/plugin   ->  Marketplaces tab  ->  patina  ->  Enable auto-update
```

(Manual alternative: `/plugin marketplace update patina` then `/reload-plugins`.)

Uninstall with `/plugin uninstall patina@patina`. This path loads the repo-root `SKILL.md` as the `/patina` skill. The git/symlink paths below (A/B/C) are for non-interactive installs or multi-host setups; to remove a script install, run `uninstall.sh` (or `curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/uninstall.sh | bash`).

This path installs skill files only. The CLI-first routing in `SKILL.md` also needs the patina runtime to start from the installed checkout, so verify it once: `node <installed-checkout>/bin/patina.js --version`. If startup fails, run `npm ci --omit=dev --no-audit --no-fund` in that checkout and try the version command again.

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
- Symlinks the `patina` skill into:
  - `~/.claude/skills/` (Claude Code)
  - `~/.codex/skills/` (Codex CLI)
  - `~/.cursor/rules/` (Cursor)
  - `~/.config/opencode/skills/` (OpenCode)
- Checks out a detached commit resolved from `PATINA_REF`, or from remote `HEAD` when `PATINA_REF` is unset.
- Verifies the local runtime: requires Node.js >= 18.1.0 and starts the installed CLI with `node ~/.claude/skills/patina/bin/patina.js --version`. Only when startup fails, it runs `npm ci --omit=dev --no-audit --no-fund` in the checkout and starts the CLI again. A working checkout never touches npm. Any failure here exits 1 instead of claiming success.
- Does not check backend readiness: no doctor run, no login, no backend selection.
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
| Codex CLI | `mkdir -p ~/.codex/skills && ln -snf ~/.claude/skills/patina ~/.codex/skills/patina` |
| Cursor | `mkdir -p ~/.cursor/rules && ln -snf ~/.claude/skills/patina ~/.cursor/rules/patina` |
| OpenCode | `mkdir -p ~/.config/opencode/skills && ln -snf ~/.claude/skills/patina ~/.config/opencode/skills/patina` |
| Gemini CLI | `mkdir -p ~/.gemini/skills && ln -snf ~/.claude/skills/patina ~/.gemini/skills/patina` |

### Step 3: Verify the local runtime; optionally link a global CLI

The skill's default route runs the checkout-local helper (`bin/patina-skill.js`), so the runtime must actually start from this clone. After the npm package is published, the shortest standalone path is:

```bash
npx patina-cli --lang en input.txt
```

For the cloned checkout, prove startup first:

```bash
cd ~/.claude/skills/patina
node bin/patina.js --version || npm ci --omit=dev --no-audit --no-fund
node bin/patina.js --version
```

Requires Node.js >= 18.1.0. A reply like `patina 8.5.1` means the local runtime is ready. Linking a global `patina` command is optional and separate from this readiness:

```bash
npm link
```

After linking, `patina --help` works as a shell command. Do not publish the package to npm.

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

Confirm the install succeeded by checking the canonical files, the recorded version and actual CLI startup:

```bash
test -f ~/.claude/skills/patina/SKILL.md && \
  grep '^version:' ~/.claude/skills/patina/SKILL.md
node ~/.claude/skills/patina/bin/patina.js --version
```

Expected output: `version: "8.5.1"` (or newer), then `patina 8.5.1` (or newer). The second command is the runtime readiness check: if it fails, installation is not complete even though the skill files exist.

Backend readiness is deliberately not part of installation. The skill helper checks only the selected backend when you actually invoke it, and `patina doctor` passing with any available backend does not prove the selected one is ready.

For each host you installed into, also verify the symlink target:

```bash
# Codex example — adapt path for other hosts
ls -la ~/.codex/skills/patina
# should show:  patina -> /home/<user>/.claude/skills/patina
```

---

## How to use after installation

The user can now invoke patina as a slash command in their agent. The default route runs the verified CLI helper (`bin/patina-skill.js` in the installed checkout) and returns its exact accepted output; an explicit `/patina --instruction-only` request runs the agent instruction pipeline instead, with no CLI verification:

```
/patina --lang en

[paste their text here]
```

Or with a Persona and/or Register:

```
/patina --persona natural-en --register professional

[paste their text]
```

Or via the standalone Node CLI (only if Step 3 of Path B was run):

```
patina --lang ko input.txt
```

Or through Docker (public image, published manually — see [docs/integrations/docker.md](docs/integrations/docker.md)):

```bash
printf '%s\n' 'Coffee has emerged as a pivotal cultural phenomenon.' \
  | docker run --rm -i -e PATINA_API_KEY ghcr.io/devswha/patina:latest --lang en --provider openai
```

The Docker image intentionally does not bake in codex/claude/gemini CLI binaries or logins. Use API-backed providers inside the container, or mount your own authenticated tooling explicitly.

Free tier: when [`codex`](https://github.com/openai/codex) is installed and logged in, patina works **without** an API key. The default `/patina` route and the standalone CLI both reach it when `codex-cli` is selected explicitly, by `--backend codex-cli` or by `backend: codex-cli` in `.patina.yaml` (auto-fallback was removed in v3.9 to keep agent backends opt-in). Only the explicit `--instruction-only` route uses the host agent's own model, and that route has no CLI verification.

Other backends: a logged-in `gemini` or `claude` CLI works with `--backend gemini-cli` / `--backend claude-cli` (`GEMINI_API_KEY` also works for gemini-cli); any OpenAI-compatible HTTP API works with `PATINA_API_KEY` and `--backend openai-http`. `patina --list-backends` shows what is available.

---

## Uninstall

```bash
# Remove all symlinks
rm -f ~/.codex/skills/patina
rm -f ~/.cursor/rules/patina
rm -f ~/.config/opencode/skills/patina
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
| Standalone `patina` command not found after `npm link` | `npm` global bin not on `PATH` | Tell the user to run `npm prefix -g` and add its `bin/` subdirectory to `PATH`. |
| install.sh stops with `Runtime not ready: ...` | Node.js >= 18.1.0 missing, npm missing while dependency preparation was needed, or `npm ci` failed | Install Node.js/npm or resolve the npm error, then rerun the installer. Exit 1 means no readiness was claimed. |
| Helper exits 1 with `backend_unavailable` or `backend_auth_missing` | The selected backend is not installed or not logged in | Log in to the backend you selected (yourself; nothing installs or logs in for you), or use `openai-http` with `--api-key-file` / `PATINA_API_KEY`. |
| `patina doctor` passes but the helper reports the backend unavailable | doctor accepts any usable backend; the helper requires the selected one | Select a backend that is actually ready (`--backend <name>` or `backend:` in config), or fix the selected backend. |

---

## Constraints for the installing agent

To prevent surprises:

- **Do not** install into any directory other than `~/.claude/skills/patina`. Other paths are symlinks pointing back to it.
- **Do not** use `sudo` for any step. patina installs entirely in the user's home directory.
- **Do not** modify the user's shell config (`.bashrc`, `.zshrc`, etc.) automatically. The standalone CLI is opt-in via `npm link` only.
- **Do not** delete or overwrite an existing `~/.claude/skills/patina` directory unless it is a git repo — and even then, only via `git pull`, never `rm -rf` followed by `git clone`.
- **Do** treat any error from a `git`, `mkdir`, `ln`, or `npm` command as fatal. Report and stop.
- **Do not** run `patina auth login` or any backend login flow on the user's behalf, and do not expand permissions. Installation never authenticates a backend.
- **Do not** publish anything to npm or create tags, and do not claim backend readiness from `patina doctor`. Selected-backend readiness is established per invocation by the skill helper.

---

## What patina is (one paragraph for context)

patina detects and rewrites AI writing patterns in Korean, English, Chinese, and Japanese. It runs as a skill in any agent that supports the file-based skill convention, or as a standalone Node.js CLI. Unlike a generic paraphraser, patina is **pattern-based and auditable**: every change is tied to a named pattern from the loaded packs (`ko-content`, `en-style`, etc.), and the original claims are verified to survive the rewrite via a meaning-preservation score (MPS ≥ 70). See `README.md` in the cloned repo for full feature details.
