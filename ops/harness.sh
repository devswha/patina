#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

REPO_DIR="/home/devswha/workspace/patina"
ENV_FILE="${PATINA_ENV_FILE:-$REPO_DIR/.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

RUNTIME_CLI="${PATINA_RUNTIME_CLI:-}"
LOCK_FILE="${LOCK_FILE:-/tmp/patina-bot.lock}"
LOG_DIR="$REPO_DIR/ops/logs"
ARTIFACT_ROOT="$REPO_DIR/artifacts/harness"
DISCORD_CHANNEL="${DISCORD_CHANNEL:-}"
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
GENERATOR_RESULT="$RUN_DIR/generator-result.json"
PR_BODY_FILE="$RUN_DIR/pr-body.md"

mkdir -p "$LOG_DIR" "$RUN_DIR"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

CURRENT_BRANCH=""
PUSHED_BRANCH="false"
PR_NUMBER=""
FINAL_STATUS="failure"
FINAL_REASON=""

[ -n "$RUNTIME_CLI" ] || { echo "PATINA_RUNTIME_CLI가 필요합니다 (.env 또는 환경 변수 설정)" >&2; exit 1; }
command -v "$RUNTIME_CLI" >/dev/null 2>&1 || { echo "$RUNTIME_CLI CLI를 찾을 수 없음" >&2; exit 1; }
[ -n "$DISCORD_CHANNEL" ] || { echo "DISCORD_CHANNEL이 필요합니다 (.env 또는 환경 변수 설정)" >&2; exit 1; }

# --- 비정상 종료 시 main 복귀 + 알림 ---
on_unexpected_exit() {
  local exit_code=$?
  cd "$REPO_DIR" 2>/dev/null || true
  git checkout main >/dev/null 2>&1 || true
  if [ "$FINAL_STATUS" = "failure" ]; then
    echo "UNEXPECTED EXIT (code=$exit_code) at $(date +%H:%M:%S)" >> "$LOG_FILE" 2>/dev/null || true
    "$RUNTIME_CLI" message send --channel discord --target "channel:${DISCORD_CHANNEL}" \
      --message "⚠️ patina 봇: harness 비정상 종료 (exit $exit_code) — run $RUN_ID" \
      >/dev/null 2>&1 || true
  fi
}
trap on_unexpected_exit EXIT

notify() {
  local msg="$1"
  "$RUNTIME_CLI" message send \
    --channel discord \
    --target "channel:${DISCORD_CHANNEL}" \
    --message "$msg" \
    >/dev/null 2>&1 || echo "WARNING: runtime notification failed"
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

  "$RUNTIME_CLI" config get agents.list --json 2>/dev/null | node -e '
let data = "";
process.stdin.on("data", (chunk) => data += chunk);
process.stdin.on("end", () => {
  let list;
  try { list = JSON.parse(data || "[]"); } catch { process.exit(1); }
  if (!Array.isArray(list)) process.exit(1);
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

  # --- 항상 main으로 복귀 ---
  git checkout main >/dev/null 2>&1 || true

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
  timeout "$((timeout_seconds + 120))" "$RUNTIME_CLI" --no-color agent \
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
  if [ -n "$(git diff --name-only 2>/dev/null)$(git diff --cached --name-only 2>/dev/null)" ]; then
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

  prompt_template="$(<"$REPO_DIR/ops/harness-prompts/planner.md")"
  open_issues="$(gh issue list --state open --limit 50 --json number,title,labels,createdAt,url 2>/dev/null || echo "[]")"
  recent_prs="$(gh pr list --state all --limit 5 --json number,title,state,mergedAt,headRefName,url 2>/dev/null || echo "[]")"
  repo_state="$(collect_repo_state)"

  cat <<EOF2
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
EOF2
}

build_generator_message() {
  local revision_count="$1"
  local prompt_template repo_state spec review_summary

  prompt_template="$(<"$REPO_DIR/ops/harness-prompts/generator.md")"
  repo_state="$(collect_repo_state)"
  review_summary=""

  if [ "$revision_count" -gt 0 ] && [ -f "$REVIEW_PATH" ]; then
    review_summary="$(cat "$REVIEW_PATH")"
  fi

  cat <<EOF2
$prompt_template

## Execution Contract
- Work only on a bot/* branch.
- Write unified diff to: $DIFF_PATH
- Write machine-readable JSON to: $GENERATOR_RESULT
- Read spec from: $SPEC_PATH
- If revising, also read review feedback from: $REVIEW_PATH
- Do not push or open a PR.

## Injected Context
- Revision count: $revision_count / $MAX_REVISE_LOOPS
- Repo state:
\`\`\`json
$repo_state
\`\`\`
${review_summary:+- Review feedback:
\`\`\`
$review_summary
\`\`\`}
EOF2
}

build_evaluator_message() {
  local revision_count="$1"
  local prompt_template repo_state

  prompt_template="$(<"$REPO_DIR/ops/harness-prompts/evaluator.md")"
  repo_state="$(collect_repo_state)"

  cat <<EOF2
$prompt_template

## Execution Contract
- Review the generator's branch with fresh context.
- Read spec from: $SPEC_PATH
- Read diff from: $DIFF_PATH
- Write review markdown to: $REVIEW_PATH
- Append machine-readable JSON to: $RESULT_JSON
- Return only PASS, REVISE, or FAIL.

## Injected Context
- Revision count: $revision_count / $MAX_REVISE_LOOPS
- Repo state:
\`\`\`json
$repo_state
\`\`\`
EOF2
}

notify "🔍 patina 봇: harness 시작"

command -v gh >/dev/null 2>&1 || { notify "patina 봇: gh CLI를 찾을 수 없음"; finish_and_exit 1 "- Harness failed: gh CLI missing"; }
if ! "$RUNTIME_CLI" status >/dev/null 2>&1; then
  echo "Gateway unreachable — aborting" >> "$LOG_FILE"
  finish_and_exit 0 "- Harness skipped: gateway unreachable"
fi

gh auth status >/dev/null 2>&1 || { notify "patina 봇: gh 인증 실패"; finish_and_exit 1 "- Harness failed: gh auth missing"; }

for required_agent in "$PLANNER_AGENT_ID" "$GENERATOR_AGENT_ID" "$EVALUATOR_AGENT_ID"; do
  if ! agent_exists "$required_agent"; then
    notify "patina 봇: 에이전트 '$required_agent' 없음 (./ops/runtime-bootstrap.sh 실행 필요)"
    finish_and_exit 1 "- Harness failed: missing agent $required_agent"
  fi
done

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another bot instance is running. Exiting."
  finish_and_exit 0 "- Harness skipped: another instance already running"
fi

cd "$REPO_DIR"
git fetch --prune origin >/dev/null 2>&1 || true
git checkout main >/dev/null 2>&1 || true
git pull --ff-only origin main >/dev/null 2>&1 || true

while IFS= read -r branch; do
  branch="${branch#"${branch%%[![:space:]]*}"}"  # trim leading whitespace
  [ -n "$branch" ] || continue
  git branch -D "$branch" >/dev/null 2>&1 || true
done < <(git branch --list 'bot/*' 2>/dev/null)

# Delete remote bot/* branches only if they have no open PR
while IFS= read -r branch; do
  branch="${branch#"${branch%%[![:space:]]*}"}"
  [ -n "$branch" ] || continue
  if gh pr list --head "$branch" --state open --json number --jq '.[0].number' 2>/dev/null | grep -q .; then
    continue  # skip — open PR exists for this branch
  fi
  git push origin --delete "$branch" >/dev/null 2>&1 || true
done < <(git branch -r --list 'origin/bot/*' 2>/dev/null | sed 's#^ *origin/##')

notify "🧠 patina 봇: planner 실행"
if ! run_agent "planner" "$PLANNER_AGENT_ID" 300 "planner-$RUN_ID" "$(build_planner_message)"; then
  notify "❌ patina 봇: planner 실패"
  json_write_empty_result "fail" "planner_failed"
  finish_and_exit 1 "- Harness failed: planner stage error"
fi

if [ ! -f "$RESULT_JSON" ]; then
  notify "❌ patina 봇: planner 결과 없음"
  finish_and_exit 1 "- Harness failed: planner result missing"
fi

planner_status="$(json_get "$RESULT_JSON" status || true)"
if [ "$planner_status" = "skip" ]; then
  notify "💤 patina 봇: 처리할 작업 없음 (대기)"
  FINAL_STATUS="success"
  finish_and_exit 0 "- Harness skipped: no actionable tasks"
fi

if [ "$planner_status" != "ok" ] && [ "$planner_status" != "ready" ]; then
  notify "❌ patina 봇: planner가 작업을 선정하지 못함"
  finish_and_exit 1 "- Harness failed: planner status=$planner_status"
fi

notify "🛠️ patina 봇: generator 실행"
revision_count=0
if ! run_agent "generator" "$GENERATOR_AGENT_ID" 1200 "generator-$RUN_ID" "$(build_generator_message "$revision_count")"; then
  notify "❌ patina 봇: generator 실패"
  finish_and_exit 1 "- Harness failed: generator stage error"
fi

if [ ! -f "$GENERATOR_RESULT" ]; then
  notify "❌ patina 봇: generator 결과 없음"
  finish_and_exit 1 "- Harness failed: generator result missing"
fi

notify "🧪 patina 봇: evaluator 실행"
if ! run_agent "evaluator" "$EVALUATOR_AGENT_ID" 600 "evaluator-$RUN_ID" "$(build_evaluator_message "$revision_count")"; then
  notify "❌ patina 봇: evaluator 실패"
  finish_and_exit 1 "- Harness failed: evaluator stage error"
fi

# Evaluator writes {"status":"reviewed","verdict":"PASS|REVISE|FAIL"}
# Read verdict field; fall back to status for backward compat; normalize to lowercase
eval_verdict="$(json_get "$RESULT_JSON" verdict 2>/dev/null || json_get "$RESULT_JSON" status || true)"
eval_verdict="$(printf '%s' "$eval_verdict" | tr '[:upper:]' '[:lower:]')"

while [ "$eval_verdict" = "revise" ] && [ "$revision_count" -lt "$MAX_REVISE_LOOPS" ]; do
  revision_count=$((revision_count + 1))
  notify "🔁 patina 봇: revise 루프 $revision_count/$MAX_REVISE_LOOPS"

  if ! run_agent "generator-revise-$revision_count" "$GENERATOR_AGENT_ID" 1200 "generator-$RUN_ID" "$(build_generator_message "$revision_count")"; then
    notify "❌ patina 봇: revise generator 실패"
    finish_and_exit 1 "- Harness failed: generator revise stage error"
  fi

  if ! run_agent "evaluator-revise-$revision_count" "$EVALUATOR_AGENT_ID" 600 "evaluator-$RUN_ID" "$(build_evaluator_message "$revision_count")"; then
    notify "❌ patina 봇: revise evaluator 실패"
    finish_and_exit 1 "- Harness failed: evaluator revise stage error"
  fi

  eval_verdict="$(json_get "$RESULT_JSON" verdict 2>/dev/null || json_get "$RESULT_JSON" status || true)"
  eval_verdict="$(printf '%s' "$eval_verdict" | tr '[:upper:]' '[:lower:]')"
done

if [ "$eval_verdict" != "pass" ]; then
  notify "❌ patina 봇: evaluator 최종 결과 $eval_verdict"
  FINAL_STATUS="failure"
  finish_and_exit 1 "- Harness failed: evaluator verdict=$eval_verdict"
fi

CURRENT_BRANCH="bot/${RUN_ID}"

# Clean up generator's working-tree leftovers (untracked/modified files)
# before creating the harness branch and applying the diff cleanly.
# Exclude memory/ and .openclaw/ which contain runtime state.
git checkout main >/dev/null 2>&1 || true
# Delete any bot/* branches the generator created during this run
while IFS= read -r branch; do
  branch="${branch#"${branch%%[![:space:]]*}"}"
  [ -n "$branch" ] || continue
  git branch -D "$branch" >/dev/null 2>&1 || true
done < <(git branch --list 'bot/*' 2>/dev/null)
git clean -fd --exclude='memory/' --exclude='.openclaw/' >/dev/null 2>&1 || true
git checkout -- . >/dev/null 2>&1 || true

git checkout -b "$CURRENT_BRANCH" >/dev/null 2>&1 || git checkout "$CURRENT_BRANCH" >/dev/null 2>&1
if [ -f "$DIFF_PATH" ]; then
  git apply "$DIFF_PATH"
fi

git add -A
git commit -m "Automate one vetted maintenance task" -m "Planner, Generator, Evaluator harness run $RUN_ID produced a reviewed change set ready for PR creation.

Constraint: Bot branches must remain isolated from main during autonomous runs
Rejected: Push generator output before evaluator PASS | violates bot safety gate
Confidence: medium
Scope-risk: moderate
Directive: Keep evaluator gate intact before any future PR creation or merge automation
Tested: Planner/Generator/Evaluator harness run through PASS path
Not-tested: Human review beyond evaluator output" >/dev/null

git fetch origin main >/dev/null 2>&1 || true
if ! git rebase origin/main >/dev/null 2>&1; then
  git rebase --abort >/dev/null 2>&1 || true
  cleanup_branch "$CURRENT_BRANCH"
  notify "❌ patina 봇: rebase 충돌로 중단"
  FINAL_STATUS="failure"
  finish_and_exit 1 "- Harness failed: rebase conflict"
fi

git push -u origin "$CURRENT_BRANCH" >/dev/null 2>&1
PUSHED_BRANCH="true"

# Read PR metadata from generator result (prTitle/prBody), fall back to evaluator/defaults
pr_title="$(json_get "$GENERATOR_RESULT" prTitle 2>/dev/null || json_get "$RESULT_JSON" title 2>/dev/null || echo "Automated maintenance update")"
pr_body="$(json_get "$GENERATOR_RESULT" prBody 2>/dev/null || json_get "$RESULT_JSON" body 2>/dev/null || echo "Automated maintenance update.")"
printf '%s\n' "$pr_body" > "$PR_BODY_FILE"

pr_url="$(gh pr create --base main --head "$CURRENT_BRANCH" --title "$pr_title" --body-file "$PR_BODY_FILE" --label bot 2>/dev/null)"
PR_NUMBER="$(printf '%s' "$pr_url" | sed -E 's#.*/pull/([0-9]+).*#\1#')"
notify "✅ patina 봇: PR #$PR_NUMBER 생성 → $pr_url"

if [ "$AUTO_MERGE" = "true" ]; then
  gh pr merge "$PR_NUMBER" --squash --delete-branch >/dev/null 2>&1 || {
    notify "❌ patina 봇: PR #$PR_NUMBER 자동 머지 실패"
    FINAL_STATUS="failure"
    finish_and_exit 1 "- Harness failed: auto-merge failure for PR #$PR_NUMBER"
  }
  notify "🔀 patina 봇: PR #$PR_NUMBER 머지 완료"
fi

FINAL_STATUS="success"
finish_and_exit 0 "- Harness success: PR #$PR_NUMBER ($pr_url)"
