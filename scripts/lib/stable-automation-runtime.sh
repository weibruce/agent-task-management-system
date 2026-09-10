#!/usr/bin/env bash

# Shared bootstrap for GitHub runners that submit durable DAG runs to the
# auto-deployed stable Atms Manager. The caller must use `set -euo pipefail`.

initialize_stable_automation_runtime() {
  local root="${ATMS_STABLE_ROOT:-}"
  local home="${ATMS_STABLE_HOME:-}"
  local manager_url="${ATMS_STABLE_MANAGER_URL:-}"

  if [[ "$root" != /* ]] || [[ "$home" != /* ]]; then
    echo "ATMS_STABLE_ROOT and ATMS_STABLE_HOME must be absolute paths." >&2
    return 1
  fi
  if [[ ! "$manager_url" =~ ^http://(127\.[0-9.]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]+\.[0-9]+|\[[0-9A-Fa-f:]+\]):[0-9]{1,5}$ ]]; then
    echo "ATMS_STABLE_MANAGER_URL must be a loopback or private Docker-bridge HTTP URL with an explicit port." >&2
    return 1
  fi

  ATMS_STABLE_RELEASE="$(readlink -f "$root/current" 2>/dev/null || true)"
  ATMS_STABLE_NODE="$ATMS_STABLE_RELEASE/runtime/node"
  ATMS_STABLE_CLI="$ATMS_STABLE_RELEASE/atms_cli/dist/cli.js"
  ATMS_STABLE_REVISION_FILE="$ATMS_STABLE_RELEASE/REVISION"
  ATMS_STABLE_TOKEN_FILE="$home/manager/secrets/dag-mutation.token"

  if [[ "$ATMS_STABLE_RELEASE" != "$root"/releases/* ]] \
    || [ ! -x "$ATMS_STABLE_NODE" ] \
    || [ ! -f "$ATMS_STABLE_CLI" ] \
    || [ ! -f "$ATMS_STABLE_REVISION_FILE" ]; then
    echo "Stable Atms release is incomplete under $root/current." >&2
    return 1
  fi
  if [ -L "$ATMS_STABLE_TOKEN_FILE" ] || [ ! -f "$ATMS_STABLE_TOKEN_FILE" ]; then
    echo "Stable Manager DAG mutation token is missing or unsafe." >&2
    return 1
  fi
  if [ "$(stat -Lc '%a' "$ATMS_STABLE_TOKEN_FILE")" != "600" ]; then
    echo "Stable Manager DAG mutation token must have mode 0600." >&2
    return 1
  fi

  ATMS_STABLE_REVISION="$(tr -d '[:space:]' < "$ATMS_STABLE_REVISION_FILE")"
  ATMS_DAG_MUTATION_TOKEN="$(tr -d '\r\n' < "$ATMS_STABLE_TOKEN_FILE")"
  if [[ ! "$ATMS_STABLE_REVISION" =~ ^[0-9a-f]{40}$ ]] \
    || [[ ! "$ATMS_DAG_MUTATION_TOKEN" =~ ^[A-Za-z0-9_-]{43}$ ]]; then
    echo "Stable release revision or DAG mutation token has an invalid format." >&2
    return 1
  fi

  export ATMS_STABLE_RELEASE ATMS_STABLE_NODE ATMS_STABLE_CLI
  export ATMS_STABLE_REVISION ATMS_DAG_MUTATION_TOKEN
  export ATMS_HOME="$home"
  export ATMS_MANAGER_URL="$manager_url"
  export ATMS_ASSET_DIR="$ATMS_STABLE_RELEASE/assets"

  curl -fsS --connect-timeout 3 --max-time 10 "$manager_url/health" >/dev/null
}

stable_hr() {
  "$ATMS_STABLE_NODE" "$ATMS_STABLE_CLI" \
    --base-url "$ATMS_MANAGER_URL" "$@"
}
