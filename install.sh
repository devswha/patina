#!/bin/sh
# install.sh - Install patina for Claude Code and other AI agents
# Usage: curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
set -e

# Agent targets (set env vars to enable; all enabled by default if none specified)
INSTALL_CLAUDE="${INSTALL_CLAUDE:-true}"
INSTALL_CODEX="${INSTALL_CODEX:-true}"
INSTALL_CURSOR="${INSTALL_CURSOR:-true}"
INSTALL_OPCODE="${INSTALL_OPCODE:-true}"

CLAUDE_SKILLS_DIR="${HOME}/.claude/skills"
CODEX_SKILLS_DIR="${HOME}/.codex/skills"
CURSOR_RULES_DIR="${HOME}/.cursor/rules"
OPCODE_SKILLS_DIR="${HOME}/.config/opencode/skills"
PATINA_DIR="${CLAUDE_SKILLS_DIR}/patina"
REPO_URL="https://github.com/devswha/patina.git"
# Pin the installed checkout to a concrete ref. If unset, resolve the current
# remote HEAD once and check out that commit instead of tracking main.
PATINA_REF="${PATINA_REF:-}"
PATINA_REPO_READY=""

# Colors (only when outputting to a terminal)
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  RED='\033[0;31m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  GREEN=''
  YELLOW=''
  RED=''
  BOLD=''
  RESET=''
fi

info() {
  printf "%b\n" "${BOLD}$1${RESET}"
}

warn() {
  printf "%b\n" "${YELLOW}$1${RESET}"
}

success() {
  printf "%b\n" "${GREEN}$1${RESET}"
}

error() {
  printf "%b\n" "${RED}Error: $1${RESET}" >&2
  exit 1
}

# Check prerequisites
command -v git >/dev/null 2>&1 || error "git is not installed. Please install git first."

resolve_install_ref() {
  if [ -n "${PATINA_REF}" ]; then
    printf "%s" "${PATINA_REF}"
    return 0
  fi

  git ls-remote "${REPO_URL}" HEAD 2>/dev/null | awk 'NR == 1 { print $1 }'
}

checkout_install_ref() {
  dir="$1"
  ref="$2"

  set +e
  (
    cd "${dir}"
    git fetch --depth=1 origin "${ref}" || exit 10
    git checkout --detach FETCH_HEAD >/dev/null 2>&1 || exit 11
  )
  rc="$?"
  set -e
  if [ "${rc}" = "10" ]; then
    error "Failed to fetch patina ref '${ref}'. Use PATINA_REF=<tag-or-full-sha>."
  fi
  if [ "${rc}" = "11" ]; then
    error "Failed to check out patina ref '${ref}'."
  fi
  if [ "${rc}" != "0" ]; then
    error "Failed to install patina ref '${ref}'."
  fi
}

# Runtime readiness belongs to this checkout, not a dependency marker or a
# globally linked CLI. Prepare dependencies only when actual startup fails.
install_runtime_deps() {
  info "Skill files installed at ${PATINA_DIR}."
  info "Backend readiness: not checked. Installation does not select or authenticate a backend."
  command -v node >/dev/null 2>&1 || error "Runtime not ready: install Node.js >=18.1.0 and rerun the installer."
  if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 18 || (major === 18 && minor >= 1) ? 0 : 1)'; then
    error "Runtime not ready: Node.js >=18.1.0 is required."
  fi
  if ! node "${PATINA_DIR}/bin/patina.js" --version >/dev/null 2>&1; then
    command -v npm >/dev/null 2>&1 || error "Runtime not ready: npm is required to prepare dependencies in ${PATINA_DIR}. Install npm and rerun the installer."
    info "Installing patina runtime dependencies from the lockfile..."
    if ! ( cd "${PATINA_DIR}" && npm ci --omit=dev --no-audit --no-fund ); then
      error "Runtime not ready: dependency installation failed in ${PATINA_DIR}. Resolve the npm error and rerun the installer."
    fi
    node "${PATINA_DIR}/bin/patina.js" --version || error "Runtime not ready: the installed CLI failed to start after dependency preparation."
  fi
  success "Local CLI runtime ready: node \"${PATINA_DIR}/bin/patina.js\" --version"
}

# Ensure the patina repo checkout exists at PATINA_DIR (clone or update once).
# Idempotent and tool-neutral so any single agent can be installed on its own,
# without requiring Claude Code to be installed first.
ensure_patina_repo() {
  if [ -n "${PATINA_REPO_READY}" ]; then
    return 0
  fi
  if [ -d "${PATINA_DIR}/.git" ]; then
    info "Updating existing patina installation..."
    checkout_install_ref "${PATINA_DIR}" "${INSTALL_REF}"
  else
    if [ -d "${PATINA_DIR}" ]; then
      error "${PATINA_DIR} exists but is not a git repo. Remove it and try again."
    fi
    mkdir -p "$(dirname "${PATINA_DIR}")"
    info "Cloning patina at ${INSTALL_REF}..."
    git clone --depth=1 "${REPO_URL}" "${PATINA_DIR}" || error "Failed to clone patina. Check your network connection."
    checkout_install_ref "${PATINA_DIR}" "${INSTALL_REF}"
  fi
  install_runtime_deps
  PATINA_REPO_READY=1
}

INSTALL_REF="$(resolve_install_ref)"
if [ -z "${INSTALL_REF}" ]; then
  error "Failed to resolve patina install ref. Set PATINA_REF=<tag-or-full-sha> and retry."
fi

# --- Claude Code ---
if [ "${INSTALL_CLAUDE}" = "true" ]; then
  info "Installing for Claude Code..."

  ensure_patina_repo

  success "Claude Code: skill files installed"
else
  warn "Skipping Claude Code installation (INSTALL_CLAUDE=false)"
fi

# --- Codex CLI ---
if [ "${INSTALL_CODEX}" = "true" ]; then
  info "Installing for Codex CLI..."

  if [ ! -d "${CODEX_SKILLS_DIR}" ]; then
    info "Creating ${CODEX_SKILLS_DIR}..."
    mkdir -p "${CODEX_SKILLS_DIR}"
  fi

  ensure_patina_repo
  ln -snf "${PATINA_DIR}" "${CODEX_SKILLS_DIR}/patina"
  success "Codex: /patina linked to ${CODEX_SKILLS_DIR}"
else
  warn "Skipping Codex installation (INSTALL_CODEX=false)"
fi

# --- Cursor ---
if [ "${INSTALL_CURSOR}" = "true" ]; then
  info "Installing for Cursor..."

  if [ ! -d "${CURSOR_RULES_DIR}" ]; then
    info "Creating ${CURSOR_RULES_DIR}..."
    mkdir -p "${CURSOR_RULES_DIR}"
  fi

  # Cursor rules are inside the repo; symlink or copy depending on install method
  ensure_patina_repo
  if [ -f "${PATINA_DIR}/.cursor/rules/patina.md" ]; then
    ln -snf "${PATINA_DIR}/.cursor/rules/patina.md" "${CURSOR_RULES_DIR}/patina.md"
    success "Cursor: rules linked to ${CURSOR_RULES_DIR}/patina.md"
  else
    warn "Cursor rules not found in repo. Run 'git pull' or check repo integrity."
  fi
else
  warn "Skipping Cursor installation (INSTALL_CURSOR=false)"
fi

# --- OpenCode / Sisyphus ---
if [ "${INSTALL_OPCODE}" = "true" ]; then
  info "Installing for OpenCode / Sisyphus..."

  if [ ! -d "${OPCODE_SKILLS_DIR}" ]; then
    info "Creating ${OPCODE_SKILLS_DIR}..."
    mkdir -p "${OPCODE_SKILLS_DIR}"
  fi

  ensure_patina_repo
  # OpenCode uses AGENTS.md + standalone-prompt.md as the skill interface
  ln -snf "${PATINA_DIR}" "${OPCODE_SKILLS_DIR}/patina"
  success "OpenCode: skill linked to ${OPCODE_SKILLS_DIR}/patina"
else
  warn "Skipping OpenCode installation (INSTALL_OPCODE=false)"
fi

# Done
printf "\n"
if [ -n "${PATINA_REPO_READY}" ]; then
  success "✓ patina skill files installed; local CLI runtime ready. Backend readiness not checked."
else
  info "No agent targets enabled; nothing installed and runtime/backend readiness not checked."
fi
info "  If it saves you edits, a star helps others find it → https://github.com/devswha/patina"
printf "\n"
info "Usage:"
if [ "${INSTALL_CLAUDE}" = "true" ]; then
  printf "  Claude Code:\n"
  printf "    /patina              Humanize Korean text\n"
  printf "    /patina --lang en    Humanize English text\n"
fi
if [ "${INSTALL_CODEX}" = "true" ]; then
  printf "  Codex CLI:\n"
  printf "    /patina              Humanize Korean text\n"
  printf "    /patina --lang en    Humanize English text\n"
fi
if [ "${INSTALL_CURSOR}" = "true" ]; then
  printf "  Cursor:\n"
  printf "    Rules loaded from ~/.cursor/rules/patina.md\n"
fi
if [ "${INSTALL_OPCODE}" = "true" ]; then
  printf "  OpenCode / Sisyphus:\n"
  printf "    Skill loaded from ~/.config/opencode/skills/patina\n"
  printf "    Use AGENTS.md + core/standalone-prompt.md\n"
fi
printf "\n"
info "Environment variables to control installation:"
printf "  PATINA_REF=<tag-or-full-sha>  Pin installed checkout (default: resolved remote HEAD SHA)\n"
printf "  INSTALL_CLAUDE=true|false    (default: true)\n"
printf "  INSTALL_CODEX=true|false     (default: true)\n"
printf "  INSTALL_CURSOR=true|false    (default: true)\n"
printf "  INSTALL_OPCODE=true|false    (default: true)\n"
printf "\n"
