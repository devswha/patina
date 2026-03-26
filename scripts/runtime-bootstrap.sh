#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PATINA_ENV_FILE:-$REPO_DIR/.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

RUNTIME_CLI="${PATINA_RUNTIME_CLI:-}"
PATINA_AGENT_ID="${PATINA_AGENT_ID:-patina}"
PLANNER_AGENT_ID="${PLANNER_AGENT_ID:-planner}"
GENERATOR_AGENT_ID="${GENERATOR_AGENT_ID:-generator}"
EVALUATOR_AGENT_ID="${EVALUATOR_AGENT_ID:-evaluator}"
DISCORD_CHANNEL="${DISCORD_CHANNEL:-}"
DISCORD_GUILD="${DISCORD_GUILD:-}"
DISCORD_ALLOWED_USERS="${DISCORD_ALLOWED_USERS:-}"
RUNTIME_ENFORCE_ALLOWLIST="${RUNTIME_ENFORCE_ALLOWLIST:-false}"
RESTART_GATEWAY="${RESTART_GATEWAY:-true}"
CLAWHIP_CONFIG="${CLAWHIP_CONFIG:-$HOME/.clawhip/config.toml}"
RUNTIME_DISCORD_TOKEN="${RUNTIME_DISCORD_TOKEN:-}"
SYSTEMD_USER_DIR="${SYSTEMD_USER_DIR:-$HOME/.config/systemd/user}"
COMPONENT_BRIDGE_SERVICE="${COMPONENT_BRIDGE_SERVICE:-patina-component-bridge.service}"

[ -n "$RUNTIME_CLI" ] || { echo "PATINA_RUNTIME_CLI가 필요합니다 (.env 또는 환경 변수 설정)" >&2; exit 1; }
command -v "$RUNTIME_CLI" >/dev/null 2>&1 || { echo "$RUNTIME_CLI CLI를 찾을 수 없음" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node를 찾을 수 없음" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3를 찾을 수 없음" >&2; exit 1; }
[ -n "$DISCORD_CHANNEL" ] || { echo "DISCORD_CHANNEL이 필요합니다 (.env 또는 환경 변수 설정)" >&2; exit 1; }
[ -n "$DISCORD_GUILD" ] || { echo "DISCORD_GUILD가 필요합니다 (.env 또는 환경 변수 설정)" >&2; exit 1; }
if [ "$RUNTIME_ENFORCE_ALLOWLIST" = "true" ] && [ -z "$DISCORD_ALLOWED_USERS" ]; then
  echo "RUNTIME_ENFORCE_ALLOWLIST=true 인 경우 DISCORD_ALLOWED_USERS가 필요합니다" >&2
  exit 1
fi

if [ -z "$RUNTIME_DISCORD_TOKEN" ] && [ -f "$CLAWHIP_CONFIG" ]; then
  RUNTIME_DISCORD_TOKEN="$(python3 - "$CLAWHIP_CONFIG" <<'PY'
import re
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text()
match = re.search(r'(?ms)^\[providers\.discord\]\s.*?^token\s*=\s*"([^"]+)"', text)
if match:
    print(match.group(1), end="")
PY
)"
fi

export PATINA_AGENT_ID PLANNER_AGENT_ID GENERATOR_AGENT_ID EVALUATOR_AGENT_ID DISCORD_CHANNEL DISCORD_GUILD DISCORD_ALLOWED_USERS RUNTIME_DISCORD_TOKEN

ensure_agent_workspace() {
  local agent_id="$1"
  local agent_workspace

  agent_workspace="$({ "$RUNTIME_CLI" config get agents.list --json 2>/dev/null || echo '[]'; } | node -e '
let data="";
process.stdin.on("data", (chunk) => data += chunk);
process.stdin.on("end", () => {
  const list = JSON.parse(data || "[]");
  const agent = list.find((item) => item && item.id === process.argv[1]);
  process.stdout.write(agent?.workspace || "");
});
' "$agent_id")"

  if [ -z "$agent_workspace" ]; then
    echo "[bootstrap] adding runtime agent: $agent_id"
    "$RUNTIME_CLI" agents add "$agent_id" --non-interactive --workspace "$REPO_DIR" >/dev/null
  elif [ "$agent_workspace" != "$REPO_DIR" ]; then
    echo "[bootstrap] agent '$agent_id' already exists with a different workspace: $agent_workspace" >&2
    exit 1
  else
    echo "[bootstrap] runtime agent already exists: $agent_id"
  fi

  "$RUNTIME_CLI" agents set-identity --agent "$agent_id" --workspace "$REPO_DIR" --from-identity >/dev/null
}
ensure_agent_workspace "$PATINA_AGENT_ID"

for agent_id in "$PLANNER_AGENT_ID" "$GENERATOR_AGENT_ID" "$EVALUATOR_AGENT_ID"; do
  ensure_agent_workspace "$agent_id"
done

if [ -n "$RUNTIME_DISCORD_TOKEN" ]; then
  echo "[bootstrap] syncing Discord token from migrated bot config"
  token_json="$(python3 -c 'import json, sys; print(json.dumps(sys.argv[1]))' "$RUNTIME_DISCORD_TOKEN")"
  "$RUNTIME_CLI" config set channels.discord.token "$token_json" --json >/dev/null
else
  echo "[bootstrap] warning: Discord token source not found; keeping existing runtime token" >&2
fi

echo "[bootstrap] syncing Discord peer binding"
bindings_json="$("$RUNTIME_CLI" config get bindings --json 2>/dev/null || echo '[]')"
updated_bindings="$(BINDINGS_JSON="$bindings_json" node -e '
const bindings = JSON.parse(process.env.BINDINGS_JSON || "[]");
const agentId = process.env.PATINA_AGENT_ID;
const channelId = process.env.DISCORD_CHANNEL;
const filtered = bindings.filter((entry) => {
  const match = entry?.match;
  return !(match?.channel === "discord" && match?.peer?.kind === "channel" && String(match?.peer?.id) === channelId);
});
filtered.push({
  agentId,
  match: {
    channel: "discord",
    peer: {
      kind: "channel",
      id: channelId,
    },
  },
});
process.stdout.write(JSON.stringify(filtered));
')"
"$RUNTIME_CLI" config set bindings "$updated_bindings" --json >/dev/null

echo "[bootstrap] storing patina guild/channel metadata"
guilds_json="$("$RUNTIME_CLI" config get channels.discord.guilds --json 2>/dev/null || echo '{}')"
updated_guilds="$(GUILDS_JSON="$guilds_json" node -e '
const guilds = JSON.parse(process.env.GUILDS_JSON || "{}");
const guildId = process.env.DISCORD_GUILD;
const channelId = process.env.DISCORD_CHANNEL;
const users = (process.env.DISCORD_ALLOWED_USERS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const guild = guilds[guildId] && typeof guilds[guildId] === "object" ? guilds[guildId] : {};
guild.requireMention = false;
guild.users = Array.from(new Set([...(Array.isArray(guild.users) ? guild.users : []), ...users]));

const channels = guild.channels && typeof guild.channels === "object" ? guild.channels : {};
const channel = channels[channelId] && typeof channels[channelId] === "object" ? channels[channelId] : {};
channel.requireMention = false;
channel.users = Array.from(new Set([...(Array.isArray(channel.users) ? channel.users : []), ...users]));
channels[channelId] = channel;

guild.channels = channels;
guilds[guildId] = guild;
process.stdout.write(JSON.stringify(guilds));
')"
"$RUNTIME_CLI" config set channels.discord.guilds "$updated_guilds" --json >/dev/null
"$RUNTIME_CLI" config set channels.discord.enabled true --json >/dev/null
"$RUNTIME_CLI" config set channels.discord.allowBots true --json >/dev/null

if [ "$RUNTIME_ENFORCE_ALLOWLIST" = "true" ]; then
  echo "[bootstrap] enabling strict Discord allowlist policy"
  "$RUNTIME_CLI" config set channels.discord.groupPolicy '"allowlist"' --json >/dev/null
else
  current_policy="$("$RUNTIME_CLI" config get channels.discord.groupPolicy 2>/dev/null || true)"
  if [ "$current_policy" != "allowlist" ]; then
    echo "[bootstrap] note: channels.discord.groupPolicy is still '$current_policy'"
    echo "[bootstrap]       rerun with RUNTIME_ENFORCE_ALLOWLIST=true to match the old single-channel lockdown"
  fi
fi

if systemctl --user list-unit-files 2>/dev/null | grep -q '^patina-listener\.service'; then
  echo "[bootstrap] disabling legacy discord.js listener to avoid duplicate replies"
  systemctl --user disable --now patina-listener.service >/dev/null 2>&1 || true
fi

if command -v systemctl >/dev/null 2>&1; then
  echo "[bootstrap] installing component-only bot bridge service"
  mkdir -p "$SYSTEMD_USER_DIR"
  install -m 644 "$REPO_DIR/scripts/patina-component-bridge.service" "$SYSTEMD_USER_DIR/$COMPONENT_BRIDGE_SERVICE"
  systemctl --user daemon-reload
  systemctl --user enable --now "$COMPONENT_BRIDGE_SERVICE" >/dev/null
fi

if [ "$RESTART_GATEWAY" = "true" ]; then
  echo "[bootstrap] restarting runtime gateway"
  "$RUNTIME_CLI" gateway restart >/dev/null
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user restart "$COMPONENT_BRIDGE_SERVICE" >/dev/null 2>&1 || true
  fi
fi

echo "[bootstrap] done"
echo "  agent:   $PATINA_AGENT_ID"
echo "  planner: $PLANNER_AGENT_ID"
echo "  generator: $GENERATOR_AGENT_ID"
echo "  evaluator: $EVALUATOR_AGENT_ID"
echo "  guild:   $DISCORD_GUILD"
echo "  channel: $DISCORD_CHANNEL"
echo "  status:  npm run runtime:status"
