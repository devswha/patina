#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_DIR="$REPO_DIR/ops/marketing-workspace-template"
ENV_FILE="${PATINA_ENV_FILE:-$REPO_DIR/.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

RUNTIME_CLI="${PATINA_RUNTIME_CLI:-}"
MARKETING_RUNTIME_PROFILE="${MARKETING_RUNTIME_PROFILE:-marketing}"
MARKETING_AGENT_ID="${MARKETING_AGENT_ID:-patina-marketing}"
MARKETING_SOURCE_AGENT_ID="${MARKETING_SOURCE_AGENT_ID:-patina}"
MARKETING_DISCORD_CHANNEL="${MARKETING_DISCORD_CHANNEL:-}"
MARKETING_DISCORD_GUILD="${MARKETING_DISCORD_GUILD:-${DISCORD_GUILD:-}}"
MARKETING_DISCORD_ALLOWED_USERS="${MARKETING_DISCORD_ALLOWED_USERS:-${DISCORD_ALLOWED_USERS:-}}"
MARKETING_DISCORD_TOKEN="${MARKETING_DISCORD_TOKEN:-}"
MARKETING_ENFORCE_ALLOWLIST="${MARKETING_ENFORCE_ALLOWLIST:-false}"
MARKETING_RESTART_GATEWAY="${MARKETING_RESTART_GATEWAY:-false}"
MARKETING_GATEWAY_PORT="${MARKETING_GATEWAY_PORT:-18889}"
MARKETING_GATEWAY_TOKEN="${MARKETING_GATEWAY_TOKEN:-}"
MARKETING_CONFIG_DIR="${MARKETING_CONFIG_DIR:-$HOME/.openclaw-$MARKETING_RUNTIME_PROFILE}"
MARKETING_CONFIG_PATH="${MARKETING_CONFIG_PATH:-$MARKETING_CONFIG_DIR/openclaw.json}"
MARKETING_WORKSPACE="${MARKETING_WORKSPACE:-$MARKETING_CONFIG_DIR/workspace}"
PRIMARY_OPENCLAW_CONFIG_PATH="${PRIMARY_OPENCLAW_CONFIG_PATH:-$HOME/.openclaw/openclaw.json}"

runtime() {
  "$RUNTIME_CLI" --profile "$MARKETING_RUNTIME_PROFILE" "$@"
}

config_json_or_default() {
  local path="$1"
  local fallback="$2"

  python3 - "$MARKETING_CONFIG_PATH" "$path" "$fallback" <<'PY'
import json
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
path = sys.argv[2]
fallback = json.loads(sys.argv[3])

if not config_path.exists():
    print(json.dumps(fallback), end="")
    raise SystemExit

try:
    data = json.loads(config_path.read_text())
except Exception:
    print(json.dumps(fallback), end="")
    raise SystemExit

value = data
for key in path.split("."):
    if not key:
        continue
    if isinstance(value, dict) and key in value:
        value = value[key]
    else:
        print(json.dumps(fallback), end="")
        raise SystemExit

print(json.dumps(value), end="")
PY
}

[ -n "$RUNTIME_CLI" ] || { echo "PATINA_RUNTIME_CLI가 필요합니다 (.env 또는 환경 변수 설정)" >&2; exit 1; }
command -v "$RUNTIME_CLI" >/dev/null 2>&1 || { echo "$RUNTIME_CLI CLI를 찾을 수 없음" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node를 찾을 수 없음" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3를 찾을 수 없음" >&2; exit 1; }
[ -n "$MARKETING_DISCORD_CHANNEL" ] || { echo "MARKETING_DISCORD_CHANNEL이 필요합니다 (.env 또는 환경 변수 설정)" >&2; exit 1; }
[ -n "$MARKETING_DISCORD_GUILD" ] || { echo "MARKETING_DISCORD_GUILD 또는 DISCORD_GUILD가 필요합니다" >&2; exit 1; }
[ -n "$MARKETING_DISCORD_TOKEN" ] || { echo "MARKETING_DISCORD_TOKEN이 필요합니다 (.env 또는 환경 변수 설정)" >&2; exit 1; }
[ -d "$TEMPLATE_DIR" ] || { echo "마케팅 workspace template 디렉터리를 찾을 수 없음: $TEMPLATE_DIR" >&2; exit 1; }

if [ "$MARKETING_ENFORCE_ALLOWLIST" = "true" ] && [ -z "$MARKETING_DISCORD_ALLOWED_USERS" ]; then
  echo "MARKETING_ENFORCE_ALLOWLIST=true 인 경우 MARKETING_DISCORD_ALLOWED_USERS 또는 DISCORD_ALLOWED_USERS가 필요합니다" >&2
  exit 1
fi

export MARKETING_AGENT_ID MARKETING_DISCORD_CHANNEL MARKETING_DISCORD_GUILD MARKETING_DISCORD_ALLOWED_USERS

seed_marketing_workspace() {
  mkdir -p "$MARKETING_WORKSPACE"

  for filename in AGENTS.md IDENTITY.md TOOLS.md USER.md; do
    install -m 644 "$TEMPLATE_DIR/$filename" "$MARKETING_WORKSPACE/$filename"
  done
}

sync_source_agent_state() {
  local source_agent_dir
  local target_agent_dir

  source_agent_dir="$(python3 - "$PRIMARY_OPENCLAW_CONFIG_PATH" "$MARKETING_SOURCE_AGENT_ID" <<'PY'
import json
import shutil
import sys
from pathlib import Path

primary_config_path = Path(sys.argv[1])
source_agent_id = sys.argv[2]

agent_dir = ""
if primary_config_path.exists():
    data = json.loads(primary_config_path.read_text())
    agent_list = data.get("agents", {}).get("list", [])
    agent = next((item for item in agent_list if isinstance(item, dict) and item.get("id") == source_agent_id), None)
    if isinstance(agent, dict):
        agent_dir = agent.get("agentDir", "") or ""

if not agent_dir:
    agent_dir = str(Path.home() / ".openclaw" / "agents" / source_agent_id / "agent")

print(agent_dir, end="")
PY
)"
  target_agent_dir="$MARKETING_CONFIG_DIR/agents/$MARKETING_AGENT_ID/agent"

  [ -n "$source_agent_dir" ] || return 0
  [ -d "$source_agent_dir" ] || return 0

  mkdir -p "$target_agent_dir"

  for filename in auth-profiles.json models.json; do
    if [ -f "$source_agent_dir/$filename" ]; then
      install -m 600 "$source_agent_dir/$filename" "$target_agent_dir/$filename"
    fi
  done

  echo "[marketing-bootstrap] copying shared auth/model config from $MARKETING_SOURCE_AGENT_ID"
  python3 - "$PRIMARY_OPENCLAW_CONFIG_PATH" "$MARKETING_CONFIG_PATH" "$MARKETING_SOURCE_AGENT_ID" "$MARKETING_AGENT_ID" <<'PY'
import json
import sys
from pathlib import Path

primary_config_path = Path(sys.argv[1])
marketing_config_path = Path(sys.argv[2])
source_agent_id = sys.argv[3]
target_agent_id = sys.argv[4]

if not primary_config_path.exists() or not marketing_config_path.exists():
    raise SystemExit

primary = json.loads(primary_config_path.read_text())
marketing = json.loads(marketing_config_path.read_text())

source_defaults = primary.get("agents", {}).get("defaults", {})
source_agents = primary.get("agents", {}).get("list", [])
source_agent = next((item for item in source_agents if isinstance(item, dict) and item.get("id") == source_agent_id), None)
source_model = ""
if isinstance(source_agent, dict):
    source_model = source_agent.get("model", "") or ""
if not source_model:
    source_model = source_defaults.get("model", {}).get("primary", "") or ""

if primary.get("auth"):
    marketing["auth"] = primary["auth"]
if primary.get("models"):
    marketing["models"] = primary["models"]

marketing.setdefault("agents", {})
marketing_defaults = marketing["agents"].setdefault("defaults", {})
for key in ("model", "models"):
    if key in source_defaults:
        marketing_defaults[key] = source_defaults[key]

for item in marketing["agents"].get("list", []):
    if isinstance(item, dict) and item.get("id") == target_agent_id and source_model:
        item["model"] = source_model

marketing_config_path.write_text(json.dumps(marketing, indent=2, ensure_ascii=False) + "\n")
PY
}

ensure_agent_workspace() {
  local agent_workspace
  local agents_json
  local updated_agents_json

  agent_workspace="$({ config_json_or_default agents.list '[]'; } | node -e '
let data = "";
process.stdin.on("data", (chunk) => data += chunk);
process.stdin.on("end", () => {
  const list = JSON.parse(data || "[]");
  const agent = list.find((item) => item && item.id === process.argv[1]);
  process.stdout.write(agent?.workspace || "");
});
' "$MARKETING_AGENT_ID")"

  if [ -z "$agent_workspace" ]; then
    echo "[marketing-bootstrap] adding runtime agent: $MARKETING_AGENT_ID"
    runtime agents add "$MARKETING_AGENT_ID" --non-interactive --workspace "$MARKETING_WORKSPACE" >/dev/null
  elif [ "$agent_workspace" != "$MARKETING_WORKSPACE" ]; then
    echo "[marketing-bootstrap] updating runtime agent workspace: $agent_workspace -> $MARKETING_WORKSPACE"
    agents_json="$(config_json_or_default agents.list '[]')"
    updated_agents_json="$(AGENTS_JSON="$agents_json" python3 - "$MARKETING_AGENT_ID" "$MARKETING_WORKSPACE" <<'PY'
import json
import os
import sys

agents = json.loads(os.environ.get("AGENTS_JSON", "[]"))
agent_id = sys.argv[1]
workspace = sys.argv[2]

for item in agents:
    if isinstance(item, dict) and item.get("id") == agent_id:
        item["workspace"] = workspace

print(json.dumps(agents), end="")
PY
)"
    runtime config set agents.list "$updated_agents_json" --json >/dev/null
  else
    echo "[marketing-bootstrap] runtime agent already exists: $MARKETING_AGENT_ID"
  fi

  runtime agents set-identity --agent "$MARKETING_AGENT_ID" --workspace "$MARKETING_WORKSPACE" --from-identity >/dev/null
}

seed_marketing_workspace
ensure_agent_workspace
sync_source_agent_state

if [ -z "$MARKETING_GATEWAY_TOKEN" ]; then
  MARKETING_GATEWAY_TOKEN="$(python3 - "$MARKETING_CONFIG_PATH" <<'PY'
import json
import secrets
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
token = ""

if config_path.exists():
    try:
        data = json.loads(config_path.read_text())
        token = data.get("gateway", {}).get("auth", {}).get("token", "")
    except Exception:
        token = ""

print(token or secrets.token_hex(16), end="")
PY
)"
fi

echo "[marketing-bootstrap] syncing isolated gateway config"
gateway_auth_json="$(python3 -c 'import json, sys; print(json.dumps({"mode": "token", "token": sys.argv[1]}))' "$MARKETING_GATEWAY_TOKEN")"
gateway_remote_json="$(python3 -c 'import json, sys; print(json.dumps({"token": sys.argv[1]}))' "$MARKETING_GATEWAY_TOKEN")"
runtime config set gateway.mode '"local"' --json >/dev/null
runtime config set gateway.bind '"loopback"' --json >/dev/null
runtime config set gateway.port "$MARKETING_GATEWAY_PORT" --json >/dev/null
runtime config set gateway.auth "$gateway_auth_json" --json >/dev/null
runtime config set gateway.remote "$gateway_remote_json" --json >/dev/null
runtime config set gateway.tailscale '{"mode":"off","resetOnExit":false}' --json >/dev/null

echo "[marketing-bootstrap] syncing isolated Discord token"
token_json="$(python3 -c 'import json, sys; print(json.dumps(sys.argv[1]))' "$MARKETING_DISCORD_TOKEN")"
runtime config set channels.discord.token "$token_json" --json >/dev/null

echo "[marketing-bootstrap] syncing Discord peer binding"
bindings_json="$(config_json_or_default bindings '[]')"
updated_bindings="$(BINDINGS_JSON="$bindings_json" node -e '
const bindings = JSON.parse(process.env.BINDINGS_JSON || "[]");
const agentId = process.env.MARKETING_AGENT_ID;
const channelId = process.env.MARKETING_DISCORD_CHANNEL;
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
runtime config set bindings "$updated_bindings" --json >/dev/null

echo "[marketing-bootstrap] storing marketing guild/channel metadata"
guilds_json="$(config_json_or_default channels.discord.guilds '{}')"
updated_guilds="$(GUILDS_JSON="$guilds_json" node -e '
const guilds = JSON.parse(process.env.GUILDS_JSON || "{}");
const guildId = process.env.MARKETING_DISCORD_GUILD;
const channelId = process.env.MARKETING_DISCORD_CHANNEL;
const users = (process.env.MARKETING_DISCORD_ALLOWED_USERS || "")
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
runtime config set channels.discord.guilds "$updated_guilds" --json >/dev/null
runtime config set channels.discord.enabled true --json >/dev/null
runtime config set channels.discord.allowBots true --json >/dev/null
runtime config set plugins.entries.discord.enabled true --json >/dev/null

if [ "$MARKETING_ENFORCE_ALLOWLIST" = "true" ]; then
  echo "[marketing-bootstrap] enabling strict Discord allowlist policy"
  runtime config set channels.discord.groupPolicy '"allowlist"' --json >/dev/null
fi

if [ "$MARKETING_RESTART_GATEWAY" = "true" ]; then
  echo "[marketing-bootstrap] restarting isolated runtime gateway"
  runtime gateway restart >/dev/null
else
  echo "[marketing-bootstrap] gateway restart skipped (set MARKETING_RESTART_GATEWAY=true to activate immediately)"
fi

echo "[marketing-bootstrap] done"
echo "  profile: $MARKETING_RUNTIME_PROFILE"
echo "  agent:   $MARKETING_AGENT_ID"
echo "  gateway: ws://127.0.0.1:$MARKETING_GATEWAY_PORT"
echo "  guild:   $MARKETING_DISCORD_GUILD"
echo "  channel: $MARKETING_DISCORD_CHANNEL"
echo "  status:  bash ops/marketing-runtime-cli.sh status"
