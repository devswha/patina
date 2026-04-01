#!/bin/sh
# install.sh - Install patina as a Claude Code skill
# Usage: curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
set -e

SKILLS_DIR="${HOME}/.claude/skills"
PATINA_DIR="${SKILLS_DIR}/patina"
REPO_URL="https://github.com/devswha/patina.git"

# Colors (only when outputting to a terminal)
if [ -t 1 ]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  GREEN=''
  RED=''
  BOLD=''
  RESET=''
fi

info() {
  printf "%b\n" "${BOLD}$1${RESET}"
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

# Create skills directory
if [ ! -d "${SKILLS_DIR}" ]; then
  info "Creating ${SKILLS_DIR}..."
  mkdir -p "${SKILLS_DIR}"
fi

# Clone or pull patina
if [ -d "${PATINA_DIR}/.git" ]; then
  info "Updating existing patina installation..."
  cd "${PATINA_DIR}"
  git pull --ff-only || error "Failed to update patina. You may have local changes."
else
  if [ -d "${PATINA_DIR}" ]; then
    error "${PATINA_DIR} exists but is not a git repo. Remove it and try again."
  fi
  info "Cloning patina..."
  git clone "${REPO_URL}" "${PATINA_DIR}" || error "Failed to clone patina. Check your network connection."
fi

# Create symlink for patina-max
info "Linking patina-max skill..."
ln -snf "${PATINA_DIR}/patina-max" "${SKILLS_DIR}/patina-max"

# Done
printf "\n"
success "patina installed successfully!"
printf "\n"
info "Usage:"
printf "  /patina              Humanize Korean text\n"
printf "  /patina --lang en    Humanize English text\n"
printf "  /patina-max          Multi-model humanization\n"
printf "\n"
