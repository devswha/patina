#!/usr/bin/env bash
set -euo pipefail

# oh-my-humanizer autonomous bot
# Runs hourly via cron. Picks one task, executes it, exits.

REPO_DIR="/home/devswha/workspace/oh-my-humanizer"
LOCK_FILE="/tmp/oh-my-humanizer-bot.lock"
LOG_DIR="$REPO_DIR/scripts/logs"
DISCORD_CHANNEL="1484400552262762496"
DATE="$(date +%Y-%m-%d)"
AUTO_MERGE="${AUTO_MERGE:-false}"

mkdir -p "$LOG_DIR"

# --- Notification helper ---
notify() {
  local msg="$1"
  clawhip send --channel "$DISCORD_CHANNEL" --message "$msg" 2>/dev/null || echo "WARNING: clawhip notification failed"
}

# --- Pre-checks ---
command -v claude >/dev/null 2>&1 || { notify "oh-my-humanizer 봇: claude CLI를 찾을 수 없음"; exit 1; }
gh auth status >/dev/null 2>&1 || { notify "oh-my-humanizer 봇: gh 인증 실패"; exit 1; }
clawhip status >/dev/null 2>&1 || echo "WARNING: clawhip daemon may be down"

# --- Stale lock detection (age > 45 minutes) ---
if [ -f "$LOCK_FILE" ]; then
  lock_age=$(( $(date +%s) - $(stat -c %Y "$LOCK_FILE" 2>/dev/null || echo "$(date +%s)") ))
  if [ "$lock_age" -gt 2700 ]; then
    rm -f "$LOCK_FILE"
    echo "WARNING: Removed stale lock (age ${lock_age}s > 2700s)"
  fi
fi

# --- Concurrency guard ---
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another bot instance is running. Exiting."
  exit 0
fi

# --- nvm initialization (cron doesn't load shell profile) ---
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$REPO_DIR"

# --- Orphaned bot/* branch cleanup ---
git branch --list 'bot/*' | while read -r branch; do
  git branch -D "$branch" 2>/dev/null || true
done
git fetch --prune origin 2>/dev/null || true

# --- Ensure clean main ---
git checkout main 2>/dev/null || true
git pull --ff-only origin main 2>/dev/null || true

# --- Assemble context ---
OPEN_ISSUES=$(gh issue list --state open --json number,title,labels 2>/dev/null || echo "[]")
RECENT_PRS=$(gh pr list --state all --limit 5 --json number,title,state 2>/dev/null || echo "[]")

# --- Read and assemble prompt via heredoc (prevents injection) ---
PROMPT_TEMPLATE=$(cat "$REPO_DIR/scripts/bot-prompt.md")
ASSEMBLED_PROMPT=$(cat <<PROMPT_EOF
$PROMPT_TEMPLATE

## Injected Context
- Date: $DATE
- Auto-merge enabled: $AUTO_MERGE
- Open issues:
\`\`\`json
$OPEN_ISSUES
\`\`\`
- Recent PRs:
\`\`\`json
$RECENT_PRS
\`\`\`
PROMPT_EOF
)

# --- Execute with timeout ---
LOG_FILE="$LOG_DIR/bot-$(date +%Y%m%d-%H%M).log"

set +e
timeout 30m claude -p \
  --dangerously-skip-permissions \
  --allowedTools "Read,Write,Edit,Glob,Grep,Bash" \
  --model sonnet \
  "$ASSEMBLED_PROMPT" \
  2>&1 | tee "$LOG_FILE"
EXIT_CODE=${PIPESTATUS[0]}
set -e

# --- Notification dispatch (4 distinct states) ---
if [ "$EXIT_CODE" -eq 0 ]; then
  if grep -q "No actionable tasks found" "$LOG_FILE" 2>/dev/null; then
    notify "oh-my-humanizer 봇: 처리할 작업 없음 (대기)"
  else
    notify "oh-my-humanizer 봇: 실행 완료"
  fi
elif [ "$EXIT_CODE" -eq 124 ]; then
  notify "oh-my-humanizer 봇: 30분 타임아웃 — 고아 브랜치 확인 필요"
else
  notify "oh-my-humanizer 봇: 실행 실패 (exit $EXIT_CODE) — 로그 확인 필요"
fi

# --- Daily log append ---
DAILY_LOG="$REPO_DIR/memory/daily/$DATE.md"
if [ ! -f "$DAILY_LOG" ]; then
  cat > "$DAILY_LOG" <<EOF
# $DATE

## Summary

- Active project: \`oh-my-humanizer\`

## Log
EOF
fi
echo "- Bot run at $(date +%H:%M): exit=$EXIT_CODE" >> "$DAILY_LOG"

# --- Inline log rotation (delete logs older than 30 days) ---
find "$LOG_DIR" -name "*.log" -mtime +30 -delete 2>/dev/null || true

exit "$EXIT_CODE"
