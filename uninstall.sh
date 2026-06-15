#!/bin/sh
# uninstall.sh - Remove patina from Claude Code and other AI agents
# Usage: curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/uninstall.sh | bash
#
# This only removes what install.sh creates. If you installed via the Claude Code
# plugin marketplace (/plugin install patina@patina), uninstall with:
#   /plugin uninstall patina@patina
set -e

# Agent targets (set env vars to disable individually; all enabled by default)
UNINSTALL_CLAUDE="${UNINSTALL_CLAUDE:-true}"
UNINSTALL_CODEX="${UNINSTALL_CODEX:-true}"
UNINSTALL_CURSOR="${UNINSTALL_CURSOR:-true}"
UNINSTALL_OPCODE="${UNINSTALL_OPCODE:-true}"

CLAUDE_SKILLS_DIR="${HOME}/.claude/skills"
CODEX_SKILLS_DIR="${HOME}/.codex/skills"
CURSOR_RULES_DIR="${HOME}/.cursor/rules"
OPCODE_SKILLS_DIR="${HOME}/.config/opencode/skills"
PATINA_DIR="${CLAUDE_SKILLS_DIR}/patina"

# Colors (only when outputting to a terminal)
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD="$(printf '\033[1m')"
  GREEN="$(printf '\033[32m')"
  YELLOW="$(printf '\033[33m')"
  RED="$(printf '\033[31m')"
  RESET="$(printf '\033[0m')"
else
  BOLD=""
  GREEN=""
  YELLOW=""
  RED=""
  RESET=""
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
  printf "%b\n" "${RED}$1${RESET}" >&2
  exit 1
}

REMOVED=0

# --- Codex CLI (symlink) ---
if [ "${UNINSTALL_CODEX}" = "true" ]; then
  TARGET="${CODEX_SKILLS_DIR}/patina"
  if [ -L "${TARGET}" ]; then
    rm -f "${TARGET}"
    success "Codex: removed ${TARGET}"
    REMOVED=1
  elif [ -e "${TARGET}" ]; then
    warn "Codex: ${TARGET} exists but is not a symlink; leaving it untouched."
  fi
fi

# --- Cursor (symlink) ---
if [ "${UNINSTALL_CURSOR}" = "true" ]; then
  TARGET="${CURSOR_RULES_DIR}/patina.md"
  if [ -L "${TARGET}" ]; then
    rm -f "${TARGET}"
    success "Cursor: removed ${TARGET}"
    REMOVED=1
  elif [ -e "${TARGET}" ]; then
    warn "Cursor: ${TARGET} exists but is not a symlink; leaving it untouched."
  fi
fi

# --- OpenCode / Sisyphus (symlink) ---
if [ "${UNINSTALL_OPCODE}" = "true" ]; then
  TARGET="${OPCODE_SKILLS_DIR}/patina"
  if [ -L "${TARGET}" ]; then
    rm -f "${TARGET}"
    success "OpenCode: removed ${TARGET}"
    REMOVED=1
  elif [ -e "${TARGET}" ]; then
    warn "OpenCode: ${TARGET} exists but is not a symlink; leaving it untouched."
  fi
fi

# --- Claude Code (cloned repo) ---
# Remove last so the symlinks above are cleared before their target disappears.
if [ "${UNINSTALL_CLAUDE}" = "true" ]; then
  if [ -L "${PATINA_DIR}" ]; then
    rm -f "${PATINA_DIR}"
    success "Claude Code: removed symlink ${PATINA_DIR}"
    REMOVED=1
  elif [ -d "${PATINA_DIR}/.git" ]; then
    rm -rf "${PATINA_DIR}"
    success "Claude Code: removed ${PATINA_DIR}"
    REMOVED=1
  elif [ -d "${PATINA_DIR}" ]; then
    error "${PATINA_DIR} exists but is not a patina git clone. Remove it manually if you are sure."
  fi
fi

printf "\n"
if [ "${REMOVED}" = "1" ]; then
  success "✓ patina uninstalled."
else
  warn "Nothing to remove. patina was not found in the standard install locations."
  info "If you installed via the Claude Code plugin marketplace, run: /plugin uninstall patina@patina"
fi
printf "\n"
info "Environment variables to control uninstallation:"
printf "  UNINSTALL_CLAUDE=true|false   (default: true)\n"
printf "  UNINSTALL_CODEX=true|false    (default: true)\n"
printf "  UNINSTALL_CURSOR=true|false   (default: true)\n"
printf "  UNINSTALL_OPCODE=true|false   (default: true)\n"
