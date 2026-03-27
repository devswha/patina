#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PATINA_ENV_FILE:-$REPO_DIR/.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

RUNTIME_CLI="${PATINA_RUNTIME_CLI:-}"
[ -n "$RUNTIME_CLI" ] || { echo "PATINA_RUNTIME_CLI가 필요합니다 (.env 또는 환경 변수 설정)" >&2; exit 1; }
command -v "$RUNTIME_CLI" >/dev/null 2>&1 || { echo "$RUNTIME_CLI CLI를 찾을 수 없음" >&2; exit 1; }

exec "$RUNTIME_CLI" "$@"
