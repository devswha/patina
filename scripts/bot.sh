#!/usr/bin/env bash
set -euo pipefail

# patina autonomous bot
# Runs hourly via cron. Picks one task, executes it, exits.

export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

REPO_DIR="/home/devswha/workspace/patina"
ENV_FILE="${PATINA_ENV_FILE:-$REPO_DIR/.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

LOCK_FILE="/tmp/patina-bot.lock"
LOG_DIR="$REPO_DIR/scripts/logs"
DISCORD_CHANNEL="${DISCORD_CHANNEL:-}"
PATINA_AGENT_ID="${PATINA_AGENT_ID:-patina}"
PATINA_BOT_SESSION_ID="${PATINA_BOT_SESSION_ID:-patina-bot-cron}"
DATE="$(date +%Y-%m-%d)"
AUTO_MERGE="${AUTO_MERGE:-false}"

mkdir -p "$LOG_DIR"

# --- nvm initialization (cron doesn't load shell profile) ---
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# --- Notification helper ---
notify() {
  local msg="$1"
  openclaw message send \
    --channel discord \
    --target "channel:${DISCORD_CHANNEL}" \
    --message "$msg" \
    >/dev/null 2>&1 || echo "WARNING: openclaw notification failed"
}

# --- Pre-checks ---
command -v openclaw >/dev/null 2>&1 || { echo "openclaw CLI를 찾을 수 없음"; exit 1; }
[ -n "$DISCORD_CHANNEL" ] || { echo "DISCORD_CHANNEL이 필요합니다 (.env 또는 환경 변수 설정)" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { notify "patina 봇: gh 인증 실패"; exit 1; }
openclaw status >/dev/null 2>&1 || echo "WARNING: openclaw gateway may be down"

if ! openclaw config get agents.list --json 2>/dev/null | node -e '
let data="";
process.stdin.on("data", (chunk) => data += chunk);
process.stdin.on("end", () => {
  const list = JSON.parse(data || "[]");
  const ok = list.some((agent) => agent && agent.id === process.argv[1]);
  process.exit(ok ? 0 : 1);
});
' "$PATINA_AGENT_ID"; then
  notify "patina 봇: OpenClaw patina 에이전트가 없음 (./scripts/openclaw-bootstrap.sh 실행 필요)"
  exit 1
fi

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
timeout 30m openclaw --no-color agent \
  --agent "$PATINA_AGENT_ID" \
  --session-id "$PATINA_BOT_SESSION_ID" \
  --thinking high \
  --timeout 1800 \
  --message "$ASSEMBLED_PROMPT" \
  2>&1 | tee "$LOG_FILE"
EXIT_CODE=${PIPESTATUS[0]}
set -e

# --- Notification dispatch (4 distinct states) ---
if [ "$EXIT_CODE" -eq 0 ]; then
  if grep -q "No actionable tasks found" "$LOG_FILE" 2>/dev/null; then
    notify "patina 봇: 처리할 작업 없음 (대기)"
  else
    notify "patina 봇: 실행 완료"
  fi
elif [ "$EXIT_CODE" -eq 124 ]; then
  notify "patina 봇: 30분 타임아웃 — 고아 브랜치 확인 필요"
else
  notify "patina 봇: 실행 실패 (exit $EXIT_CODE) — 로그 확인 필요"
fi

# --- Daily log append ---
DAILY_LOG="$REPO_DIR/memory/daily/$DATE.md"
if [ ! -f "$DAILY_LOG" ]; then
  cat > "$DAILY_LOG" <<LOG_EOF
# $DATE

## Summary

- Active project: \`patina\`

## Log
LOG_EOF
fi
echo "- Bot run at $(date +%H:%M): exit=$EXIT_CODE" >> "$DAILY_LOG"

# --- Inline log rotation (delete logs older than 30 days) ---
find "$LOG_DIR" -name "*.log" -mtime +30 -delete 2>/dev/null || true

exit "$EXIT_CODE"
