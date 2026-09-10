#!/usr/bin/env bash

# Shared Worker build network contract for operator entry points.
#
# Public source settings (identical names and validation to the Manager's
# resolver in atms_manager/src/server/worker-build-network.ts):
#
#   ATMS_WORKER_BUILD_APT_MIRROR           optional Debian main repository URL
#   ATMS_WORKER_BUILD_APT_SECURITY_MIRROR  optional Debian security repository URL
#   ATMS_WORKER_BUILD_NPM_REGISTRY         optional npm registry URL
#   ATMS_WORKER_BUILD_DSH_GIT_REMOTE       optional DeepSeek Harness Git mirror URL
#
# Unset or whitespace-only values leave the corresponding source unchanged.
# Normalization and validation are delegated to the Worker WHATWG URL helper
# at atms_worker/scripts/configure-apt-sources.mjs: this script passes
# only the environment variable name, so a source value never appears in
# argv, captured commands, or logs. ${NODE_BIN:-node} selects the Node binary
# used for that delegation. Invalid values fail before Docker starts; the
# error names the configuration key but never its value.
#
# Recognized uppercase and lowercase HTTP_PROXY, HTTPS_PROXY, and NO_PROXY
# variables are forwarded as value-less Docker --build-arg NAME entries only
# when they contain a non-whitespace character. Their values are never expanded
# into argv, inspected, or logged; the Docker client/BuildKit proxy configuration
# remains authoritative.
#
# The helper populates the global ATMS_WORKER_BUILD_NETWORK_ARGS argv
# array. This avoids Bash 4.3 namerefs so the contract also works with the
# Bash 3.2 runtime shipped by macOS. It never evaluates or executes validated
# input. It also forces Docker's built-in BuildKit frontend so the canonical
# Dockerfile cache mounts are interpreted without fetching a separately pinned
# frontend image. Callers must use `set -euo pipefail`.

# atms_worker_build_network_helper_path
#
# Prints the absolute path of the Worker WHATWG URL helper, derived safely
# from this file's own location so the repository-relative contract path
# atms_worker/scripts/configure-apt-sources.mjs resolves in any checkout,
# staged release, or contract-test sandbox.
atms_worker_build_network_helper_path() {
  local lib_dir repo_root
  lib_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)" || return 1
  repo_root="$(cd -- "$lib_dir/../.." >/dev/null 2>&1 && pwd -P)" || return 1
  printf '%s/atms_worker/scripts/configure-apt-sources.mjs\n' "$repo_root"
}

# atms_worker_build_network_normalize_source NAME
#
# Prints the normalized URL for the public source setting NAME. Only NAME
# crosses the process boundary; the Worker helper reads the value from the
# environment itself and prints the normalized public URL. Prints nothing and
# returns 0 when the variable is unset-equivalent (empty or whitespace-only).
# Returns 1 with an error naming NAME (never its value) when the value is
# invalid, or when the Worker helper is unavailable.
atms_worker_build_network_normalize_source() {
  local name="$1"
  local helper_path
  if ! helper_path="$(atms_worker_build_network_helper_path)"; then
    echo "$name cannot be validated: unable to resolve the repository root from scripts/lib/worker-build-network.sh." >&2
    return 1
  fi
  if [ ! -f "$helper_path" ]; then
    echo "$name cannot be validated: atms_worker/scripts/configure-apt-sources.mjs is missing." >&2
    return 1
  fi
  local normalized
  if ! normalized="$("${NODE_BIN:-node}" "$helper_path" --print-env "$name")"; then
    return 1
  fi
  if [ -n "$normalized" ]; then
    printf '%s\n' "$normalized"
  fi
  return 0
}

# atms_worker_build_network_args
#
# Validates the public build source settings from the environment and appends
# Docker build arguments to the global ATMS_WORKER_BUILD_NETWORK_ARGS array:
#   --build-arg ATMS_WORKER_BUILD_APT_MIRROR=<url>
#   --build-arg ATMS_WORKER_BUILD_APT_SECURITY_MIRROR=<url>
#   --build-arg NPM_CONFIG_REGISTRY=<url>
#   --build-arg ATMS_DSH_FORK_REPOSITORY=<url>
# plus one value-less --build-arg NAME entry for every recognized proxy variable
# containing a non-whitespace character. Returns 1 before any Docker invocation
# when a value is invalid.
atms_worker_build_network_args() {
  DOCKER_BUILDKIT=1
  export DOCKER_BUILDKIT
  ATMS_WORKER_BUILD_NETWORK_ARGS=()
  local name normalized proxy_name
  for name in ATMS_WORKER_BUILD_APT_MIRROR ATMS_WORKER_BUILD_APT_SECURITY_MIRROR ATMS_WORKER_BUILD_NPM_REGISTRY ATMS_WORKER_BUILD_DSH_GIT_REMOTE; do
    if ! normalized="$(atms_worker_build_network_normalize_source "$name")"; then
      return 1
    fi
    if [ -n "$normalized" ]; then
      case "$name" in
        ATMS_WORKER_BUILD_NPM_REGISTRY)
          ATMS_WORKER_BUILD_NETWORK_ARGS+=("--build-arg" "NPM_CONFIG_REGISTRY=$normalized")
          ;;
        ATMS_WORKER_BUILD_DSH_GIT_REMOTE)
          ATMS_WORKER_BUILD_NETWORK_ARGS+=("--build-arg" "ATMS_DSH_FORK_REPOSITORY=$normalized")
          ;;
        *)
          ATMS_WORKER_BUILD_NETWORK_ARGS+=("--build-arg" "$name=$normalized")
          ;;
      esac
    fi
  done
  for proxy_name in HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy; do
    if [[ "${!proxy_name-}" =~ [^[:space:]] ]]; then
      ATMS_WORKER_BUILD_NETWORK_ARGS+=("--build-arg" "$proxy_name")
    fi
  done
  return 0
}
