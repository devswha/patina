#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

REPO_DIR="/home/devswha/workspace/patina"
LOCK_FILE="${LOCK_FILE:-/tmp/patina-bot.lock}"
LOG_DIR="$REPO_DIR/scripts/logs"
ARTIFACT_ROOT="$REPO_DIR/artifacts/harness"
DISCORD_CHANNEL="${DISCORD_CHANNEL:-1484400552262762496}"
AUTO_MERGE="${AUTO_MERGE:-false}"
PLANNER_AGENT_ID="${PLANNER_AGENT_ID:-planner}"
GENERATOR_AGENT_ID="${GENERATOR_AGENT_ID:-generator}"
EVALUATOR_AGENT_ID="${EVALUATOR_AGENT_ID:-evaluator}"
MAX_REVISE_LOOPS="${MAX_REVISE_LOOPS:-3}"
DATE="$(date +%Y-%m-%d)"
RUN_ID="$(date +%Y%m%d-%H%M)"
RUN_DIR="$ARTIFACT_ROOT/$RUN_ID"
LOG_FILE="$LOG_DIR/harness-$RUN_ID.log"
SPEC_PATH="$RUN_DIR/spec.md"
DIFF_PATH="$RUN_DIR/diff.patch"
REVIEW_PATH="$RUN_DIR/review.md"
RESULT_JSON="$RUN_DIR/result.json"
PR_BODY_FILE="$RUN_DIR/pr-body.md"

mkdir -p "$LOG_DIR" "$RUN_DIR"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

CURRENT_BRANCH=""
PUSHED_BRANCH="false"
PR_NUMBER=""
FINAL_STATUS="failure"
FINAL_REASON=""

notify() {
  local msg="$1"
  openclaw message send \
    --channel discord \
    --target "channel:${DISCORD_CHANNEL}" \
    --message "$msg" \
    >/dev/null 2>&1 || echo "WARNING: openclaw notification failed"
}

append_daily_log() {
  local entry="$1"
  local daily_log="$REPO_DIR/memory/daily/$DATE.md"

  if [ ! -f "$daily_log" ]; then
    cat > "$daily_log" <<LOG_EOF
# $DATE

## Summary

- Active project: \`patina\`

## Log
LOG_EOF
  fi

  echo "$entry" >> "$daily_log"
}

json_get() {
  local file="$1"
  local path="$2"

  node -e '
const fs = require("fs");
const [file, path] = process.argv.slice(1);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
let value = data;
for (const key of path.split(".")) {
  if (!key) continue;
  value = value == null ? undefined : value[key];
}
if (value == null) process.exit(2);
if (typeof value === "string") {
  process.stdout.write(value);
} else {
  process.stdout.write(JSON.stringify(value));
}
' "$file" "$path"
}

json_write_empty_result() {
  local status="$1"
  local reason="$2"

  node -e '
const fs = require("fs");
const file = process.argv[1];
const payload = {
  status: process.argv[2],
  reason: process.argv[3],
};
fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n");
' "$RESULT_JSON" "$status" "$reason"
}

agent_exists() {
  local agent_id="$1"

  openclaw config get agents.list --json 2>/dev/null | node -e '
let data = "";
process.stdin.on("data", (chunk) => data += chunk);
process.stdin.on("end", () => {
  const list = JSON.parse(data || "[]");
  const ok = list.some((agent) => agent && agent.id === process.argv[1]);
  process.exit(ok ? 0 : 1);
});
' "$agent_id"
}

cleanup_branch() {
  local branch="$1"

  [ -n "$branch" ] || return 0

  git checkout main >/dev/null 2>&1 || true
  if [ "$PUSHED_BRANCH" = "true" ]; then
    git push origin --delete "$branch" >/dev/null 2>&1 || true
  fi
  git branch -D "$branch" >/dev/null 2>&1 || true
}

finish_and_exit() {
  local exit_code="$1"
  local summary="$2"

  if [ -n "$summary" ]; then
    append_daily_log "$summary"
  fi

  find "$LOG_DIR" -name "*.log" -mtime +30 -delete 2>/dev/null || true
  find "$ARTIFACT_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} + 2>/dev/null || true

  exit "$exit_code"
}

run_agent() {
  local stage_name="$1"
  local agent_id="$2"
  local timeout_seconds="$3"
  local session_id="$4"
  local message="$5"

  echo "[$(date +%H:%M:%S)] stage=$stage_name agent=$agent_id" | tee -a "$LOG_FILE"

  set +e
  timeout "$((timeout_seconds + 120))" openclaw --no-color agent \
    --agent "$agent_id" \
    --session-id "$session_id" \
    --timeout "$timeout_seconds" \
    --message "$message" \
    2>&1 | tee -a "$LOG_FILE"
  local exit_code=${PIPESTATUS[0]}
  set -e

  return "$exit_code"
}

collect_repo_state() {
  local branch head dirty

  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"
  head="$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")"
  if [ -n "$(git status --short 2>/dev/null)" ]; then
    dirty="true"
  else
    dirty="false"
  fi

  node -e '
const payload = {
  branch: process.argv[1],
  head: process.argv[2],
  dirty: process.argv[3] === "true",
};
process.stdout.write(JSON.stringify(payload, null, 2));
' "$branch" "$head" "$dirty"
}

build_planner_message() {
  local prompt_template open_issues recent_prs repo_state

  prompt_template="$(<"$REPO_DIR/scripts/harness-prompts/planner.md")"
  open_issues="$(gh issue list --state open --limit 50 --json number,title,labels,createdAt,url 2>/dev/null || echo "[]")"
  recent_prs="$(gh pr list --state all --limit 5 --json number,title,state,mergedAt,headRefName,url 2>/dev/null || echo "[]")"
  repo_state="$(collect_repo_state)"

  cat <<EOF
$prompt_template

## Execution Contract
- Write spec markdown to: $SPEC_PATH
- Write machine-readable JSON to: $RESULT_JSON
- Select at most one task.
- If no actionable task exists, write status "skip" and do not modify the repo.

## Injected Context
- Date: $DATE
- Auto-merge enabled: $AUTO_MERGE
- Open issues:
\`\`\`json
$open_issues
\`\`\`
- Recent PRs:
\`\`\`json
$recent_prs
\`\`\`
- Repo state:
\`\`\`json
$repo_state
\`\`\`
EOF
}

build_generator_message() {
  local prompt_template review_clause current_revision

  prompt_template="$(<"$REPO_DIR/scripts/harness-prompts/generator.md")"
  current_revision="$1"
  review_clause="No review file for this pass."

  if [ -f "$REVIEW_PATH" ]; then
    review_clause="Read review feedback from: $REVIEW_PATH"
  fi

  cat <<EOF
$prompt_template

## Execution Contract
- Read the spec from: $SPEC_PATH
- Write/update machine-readable JSON at: $RESULT_JSON
- Write the diff artifact at: $DIFF_PATH
- $review_clause
- Current revision count: $current_revision
- Max revision count: $MAX_REVISE_LOOPS
- Reuse the branch in result.json on revision passes.
- Commit locally when the work is ready.
- Do not push and do not create a PR.
EOF
}

build_evaluator_message() {
  local prompt_template current_revision

  prompt_template="$(<"$REPO_DIR/scripts/harness-prompts/evaluator.md")"
  current_revision="$1"

  cat <<EOF
$prompt_template

## Execution Contract
- Read the spec from: $SPEC_PATH
- Read the diff artifact from: $DIFF_PATH
- Write review markdown to: $REVIEW_PATH
- Write machine-readable JSON to: $RESULT_JSON
- Current revision count: $current_revision
- Max revision count: $MAX_REVISE_LOOPS
- Review the current repository diff independently before deciding.
EOF
}

create_pr() {
  local branch pr_title pr_body labels_json pr_url
  local -a label_args

  branch="$(json_get "$RESULT_JSON" "branch")"
  pr_title="$(json_get "$RESULT_JSON" "prTitle")"
  labels_json="$(json_get "$RESULT_JSON" "labels" 2>/dev/null || echo '[]')"

  node -e '
const fs = require("fs");
const file = process.argv[1];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
fs.writeFileSync(process.argv[2], (data.prBody || "") + "\n");
' "$RESULT_JSON" "$PR_BODY_FILE"

  git push -u origin "$branch" >/dev/null
  PUSHED_BRANCH="true"

  mapfile -t label_args < <(node -e '
const fs = require("fs");
const file = process.argv[1];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const labels = Array.isArray(data.labels) ? data.labels : [];
for (const label of labels) {
  if (label) console.log(label);
}
' "$RESULT_JSON")

  pr_url="$(gh pr create \
    --base main \
    --head "$branch" \
    --title "$pr_title" \
    --body-file "$PR_BODY_FILE" \
    $(for label in "${label_args[@]}"; do printf -- '--label %q ' "$label"; done)
  )"

  PR_NUMBER="$(printf '%s' "$pr_url" | node -e '
const input = require("fs").readFileSync(0, "utf8").trim();
const match = input.match(/\/pull\/(\d+)$/);
if (!match) process.exit(1);
process.stdout.write(match[1]);
')"

  notify "✅ patina 봇: PR #$PR_NUMBER 생성 → $pr_url"

  if [ "$AUTO_MERGE" = "true" ]; then
    gh pr merge "$pr_url" --squash --delete-branch >/dev/null
    notify "🔀 patina 봇: PR #$PR_NUMBER 머지 완료"
  fi
}

command -v openclaw >/dev/null 2>&1 || { echo "openclaw CLI를 찾을 수 없음"; exit 1; }
command -v gh >/dev/null 2>&1 || { echo "gh CLI를 찾을 수 없음"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node를 찾을 수 없음"; exit 1; }
command -v timeout >/dev/null 2>&1 || { echo "timeout 명령을 찾을 수 없음"; exit 1; }
gh auth status >/dev/null 2>&1 || { notify "patina 봇: gh 인증 실패"; exit 1; }
openclaw status >/dev/null 2>&1 || echo "WARNING: openclaw gateway may be down"

for required_agent in "$PLANNER_AGENT_ID" "$GENERATOR_AGENT_ID" "$EVALUATOR_AGENT_ID"; do
  if ! agent_exists "$required_agent"; then
    notify "patina 봇: OpenClaw 에이전트 '$required_agent' 없음 (./scripts/openclaw-bootstrap.sh 실행 필요)"
    exit 1
  fi
done

if [ -f "$LOCK_FILE" ]; then
  lock_age=$(( $(date +%s) - $(stat -c %Y "$LOCK_FILE" 2>/dev/null || echo "$(date +%s)") ))
  if [ "$lock_age" -gt 2700 ]; then
    rm -f "$LOCK_FILE"
    echo "WARNING: Removed stale lock (age ${lock_age}s > 2700s)" | tee -a "$LOG_FILE"
  fi
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another harness instance is running. Exiting."
  exit 0
fi

cd "$REPO_DIR"

git fetch --prune origin >/dev/null 2>&1 || true
git checkout main >/dev/null 2>&1 || true
git pull --ff-only origin main >/dev/null 2>&1 || true

if [ -n "$(git status --short 2>/dev/null)" ]; then
  notify "patina 봇: 작업 트리가 깨끗하지 않아 harness 실행 중단"
  finish_and_exit 1 "- Harness run at $(date +%H:%M): exit=1 status=dirty-worktree run=$RUN_ID"
fi

while IFS= read -r local_branch; do
  [ -n "$local_branch" ] || continue
  git branch -D "$local_branch" >/dev/null 2>&1 || true
done < <(git for-each-ref --format='%(refname:short)' refs/heads/bot)

while IFS= read -r remote_ref; do
  local_count=""
  branch_name="${remote_ref#origin/}"
  [ -n "$branch_name" ] || continue
  local_count="$(gh pr list --state open --head "$branch_name" --json number 2>/dev/null | node -e '
let data = "";
process.stdin.on("data", (chunk) => data += chunk);
process.stdin.on("end", () => {
  const list = JSON.parse(data || "[]");
  process.stdout.write(String(list.length));
});
')"
  if [ "$local_count" = "0" ]; then
    git push origin --delete "$branch_name" >/dev/null 2>&1 || true
  fi
done < <(git for-each-ref --format='%(refname:short)' refs/remotes/origin/bot)

notify "🔍 patina 봇: Planner 시작 — run $RUN_ID"
if ! run_agent "planner" "$PLANNER_AGENT_ID" 300 "planner-$RUN_ID" "$(build_planner_message)"; then
  FINAL_REASON="planner failed"
  notify "❌ patina 봇: Planner 실패 — 로그 확인 필요"
  finish_and_exit 1 "- Harness run at $(date +%H:%M): exit=1 status=planner-failed run=$RUN_ID"
fi

planner_status="$(json_get "$RESULT_JSON" "status" 2>/dev/null || echo "")"
if [ "$planner_status" = "skip" ]; then
  skip_reason="$(json_get "$RESULT_JSON" "reason" 2>/dev/null || echo "No actionable tasks found")"
  notify "💤 patina 봇: 처리할 작업 없음 (대기)"
  finish_and_exit 0 "- Harness run at $(date +%H:%M): exit=0 status=skip run=$RUN_ID reason=$skip_reason"
fi

if [ "$planner_status" != "ready" ]; then
  notify "❌ patina 봇: Planner 결과 파싱 실패"
  finish_and_exit 1 "- Harness run at $(date +%H:%M): exit=1 status=planner-invalid run=$RUN_ID"
fi

selected_issue="$(json_get "$RESULT_JSON" "issueNumber" 2>/dev/null || echo "")"
notify "📝 patina 봇: 스펙 생성 완료 — 이슈 #$selected_issue"

revision_count=0
notify "🔧 patina 봇: Generator 시작 — 이슈 #$selected_issue"
if ! run_agent "generator" "$GENERATOR_AGENT_ID" 1200 "generator-$RUN_ID" "$(build_generator_message "$revision_count")"; then
  CURRENT_BRANCH="$(json_get "$RESULT_JSON" "branch" 2>/dev/null || echo "")"
  cleanup_branch "$CURRENT_BRANCH"
  notify "❌ patina 봇: Generator 실패 — 이슈 #$selected_issue"
  finish_and_exit 1 "- Harness run at $(date +%H:%M): exit=1 status=generator-failed run=$RUN_ID issue=#${selected_issue:-na}"
fi

generator_status="$(json_get "$RESULT_JSON" "status" 2>/dev/null || echo "")"
if [ "$generator_status" != "generated" ]; then
  CURRENT_BRANCH="$(json_get "$RESULT_JSON" "branch" 2>/dev/null || echo "")"
  cleanup_branch "$CURRENT_BRANCH"
  notify "❌ patina 봇: Generator 결과 파싱 실패"
  finish_and_exit 1 "- Harness run at $(date +%H:%M): exit=1 status=generator-invalid run=$RUN_ID issue=#${selected_issue:-na}"
fi

CURRENT_BRANCH="$(json_get "$RESULT_JSON" "branch")"
notify "🧪 patina 봇: Evaluator 시작 — 브랜치 $CURRENT_BRANCH"
if ! run_agent "evaluator" "$EVALUATOR_AGENT_ID" 600 "evaluator-$RUN_ID" "$(build_evaluator_message "$revision_count")"; then
  cleanup_branch "$CURRENT_BRANCH"
  notify "❌ patina 봇: Evaluator 실패 — 브랜치 $CURRENT_BRANCH"
  finish_and_exit 1 "- Harness run at $(date +%H:%M): exit=1 status=evaluator-failed run=$RUN_ID issue=#${selected_issue:-na}"
fi

verdict="$(json_get "$RESULT_JSON" "verdict" 2>/dev/null || echo "")"

while [ "$verdict" = "REVISE" ] && [ "$revision_count" -lt "$MAX_REVISE_LOOPS" ]; do
  revision_count=$((revision_count + 1))
  notify "♻️ patina 봇: 수정 요청 — $revision_count/$MAX_REVISE_LOOPS"

  if ! run_agent "generator-revise-$revision_count" "$GENERATOR_AGENT_ID" 1200 "generator-$RUN_ID" "$(build_generator_message "$revision_count")"; then
    cleanup_branch "$CURRENT_BRANCH"
    notify "❌ patina 봇: Generator 재시도 실패 — 브랜치 $CURRENT_BRANCH"
    finish_and_exit 1 "- Harness run at $(date +%H:%M): exit=1 status=generator-revise-failed run=$RUN_ID issue=#${selected_issue:-na}"
  fi

  generator_status="$(json_get "$RESULT_JSON" "status" 2>/dev/null || echo "")"
  if [ "$generator_status" != "generated" ]; then
    cleanup_branch "$CURRENT_BRANCH"
    notify "❌ patina 봇: Generator 재시도 결과 파싱 실패"
    finish_and_exit 1 "- Harness run at $(date +%H:%M): exit=1 status=generator-revise-invalid run=$RUN_ID issue=#${selected_issue:-na}"
  fi

  CURRENT_BRANCH="$(json_get "$RESULT_JSON" "branch")"

  if ! run_agent "evaluator-revise-$revision_count" "$EVALUATOR_AGENT_ID" 600 "evaluator-$RUN_ID" "$(build_evaluator_message "$revision_count")"; then
    cleanup_branch "$CURRENT_BRANCH"
    notify "❌ patina 봇: Evaluator 재시도 실패 — 브랜치 $CURRENT_BRANCH"
    finish_and_exit 1 "- Harness run at $(date +%H:%M): exit=1 status=evaluator-revise-failed run=$RUN_ID issue=#${selected_issue:-na}"
  fi

  verdict="$(json_get "$RESULT_JSON" "verdict" 2>/dev/null || echo "")"
done

if [ "$verdict" = "PASS" ]; then
  create_pr
  FINAL_STATUS="pass"
  finish_and_exit 0 "- Harness run at $(date +%H:%M): exit=0 status=pass run=$RUN_ID issue=#${selected_issue:-na} branch=$CURRENT_BRANCH pr=#${PR_NUMBER:-na}"
fi

if [ "$verdict" = "REVISE" ]; then
  json_write_empty_result "reviewed" "revise limit reached"
  verdict="FAIL"
fi

cleanup_branch "$CURRENT_BRANCH"
failure_reason="$(json_get "$RESULT_JSON" "reason" 2>/dev/null || echo "evaluation failed")"
notify "❌ patina 봇: FAIL — 이슈 #${selected_issue:-na}, $failure_reason"
finish_and_exit 1 "- Harness run at $(date +%H:%M): exit=1 status=fail run=$RUN_ID issue=#${selected_issue:-na} reason=$failure_reason"
