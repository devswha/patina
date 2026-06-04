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

INSTALL_REF="$(resolve_install_ref)"
if [ -z "${INSTALL_REF}" ]; then
  error "Failed to resolve patina install ref. Set PATINA_REF=<tag-or-full-sha> and retry."
fi

# --- Claude Code ---
if [ "${INSTALL_CLAUDE}" = "true" ]; then
  info "Installing for Claude Code..."

  if [ ! -d "${CLAUDE_SKILLS_DIR}" ]; then
    info "Creating ${CLAUDE_SKILLS_DIR}..."
    mkdir -p "${CLAUDE_SKILLS_DIR}"
  fi

  if [ -d "${PATINA_DIR}/.git" ]; then
    info "Updating existing patina installation..."
    checkout_install_ref "${PATINA_DIR}" "${INSTALL_REF}"
  else
    if [ -d "${PATINA_DIR}" ]; then
      error "${PATINA_DIR} exists but is not a git repo. Remove it and try again."
    fi
    info "Cloning patina at ${INSTALL_REF}..."
    git clone --depth=1 "${REPO_URL}" "${PATINA_DIR}" || error "Failed to clone patina. Check your network connection."
    checkout_install_ref "${PATINA_DIR}" "${INSTALL_REF}"
  fi

  success "Claude Code: /patina ready"
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

  if [ -d "${PATINA_DIR}" ]; then
    ln -snf "${PATINA_DIR}" "${CODEX_SKILLS_DIR}/patina"
    success "Codex: /patina linked to ${CODEX_SKILLS_DIR}"
  else
    warn "Patina repo not found. Claude Code installation must succeed first."
  fi
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
  if [ -d "${PATINA_DIR}" ]; then
    if [ -f "${PATINA_DIR}/.cursor/rules/patina.md" ]; then
      ln -snf "${PATINA_DIR}/.cursor/rules/patina.md" "${CURSOR_RULES_DIR}/patina.md"
      success "Cursor: rules linked to ${CURSOR_RULES_DIR}/patina.md"
    else
      warn "Cursor rules not found in repo. Run 'git pull' or check repo integrity."
    fi
  else
    warn "Patina repo not found. Claude Code installation must succeed first."
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

  if [ -d "${PATINA_DIR}" ]; then
    # OpenCode uses AGENTS.md + standalone-prompt.md as the skill interface
    ln -snf "${PATINA_DIR}" "${OPCODE_SKILLS_DIR}/patina"
    success "OpenCode: skill linked to ${OPCODE_SKILLS_DIR}/patina"
  else
    warn "Patina repo not found. Claude Code installation must succeed first."
  fi
else
  warn "Skipping OpenCode installation (INSTALL_OPCODE=false)"
fi

# Done
printf "\n"
success "✓ patina installed."
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
