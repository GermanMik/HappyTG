#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${HAPPYTG_REPO_URL:-https://github.com/GermanMik/HappyTG.git}"
BRANCH="${HAPPYTG_INSTALL_BRANCH:-main}"
ORIGINAL_CWD="${PWD}"
BOOTSTRAP_DIR="${HAPPYTG_BOOTSTRAP_DIR:-${HOME}/.happytg/bootstrap-repo}"
BOOTSTRAP_TOOLCHAIN_MARKER="HTG_INSTALLER_BOOTSTRAP_OK:1"

log() {
  printf '%s\n' "$1"
}

fail() {
  printf 'HappyTG installer bootstrap failed: %s\n' "$1" >&2
  exit 1
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

resolve_path() {
  if [ -z "${1:-}" ]; then
    return
  fi

  case "$1" in
    /*)
      printf '%s\n' "$1"
      ;;
    *)
      printf '%s\n' "$(cd "$(dirname "$1")" 2>/dev/null && pwd)/$(basename "$1")"
      ;;
  esac
}

path_within() {
  if [ -z "${1:-}" ] || [ -z "${2:-}" ]; then
    return 1
  fi

  local candidate root
  candidate="$(resolve_path "$1")"
  root="$(resolve_path "$2")"

  case "$candidate" in
    "$root" | "$root"/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

run_root() {
  if have_cmd sudo; then
    sudo "$@"
    return
  fi

  "$@"
}

NODE_PRESENT=0
NODE_VERSION=""
NODE_MAJOR=0
NODE_ERROR=""
NODE_MISSING_PRELOAD=""
NODE_MISSING_SCOPE=""

extract_missing_preload_path() {
  printf '%s\n' "$1" | sed -n "s/.*Cannot find module '\([^']*\)'.*/\1/p" | head -n 1
}

node_probe() {
  NODE_PRESENT=0
  NODE_VERSION=""
  NODE_MAJOR=0
  NODE_ERROR=""
  NODE_MISSING_PRELOAD=""
  NODE_MISSING_SCOPE=""

  if ! have_cmd node; then
    return
  fi

  NODE_PRESENT=1
  local output status version missing_path
  set +e
  output="$(node -p "process.versions.node" 2>&1)"
  status=$?
  set -e

  if [ "$status" -eq 0 ]; then
    version="$(printf '%s\n' "$output" | head -n 1 | tr -d '\r')"
    NODE_VERSION="$version"
    NODE_MAJOR="${version%%.*}"
    return
  fi

  NODE_ERROR="$output"
  missing_path="$(extract_missing_preload_path "$output")"
  if [ -n "$missing_path" ]; then
    NODE_MISSING_PRELOAD="$(resolve_path "$missing_path")"
    if path_within "$NODE_MISSING_PRELOAD" "$BOOTSTRAP_DIR"; then
      NODE_MISSING_SCOPE="bootstrap"
    elif path_within "$NODE_MISSING_PRELOAD" "$ORIGINAL_CWD"; then
      NODE_MISSING_SCOPE="workspace"
    else
      NODE_MISSING_SCOPE="external"
    fi
  fi
}

use_bootstrap_safe_node_options() {
  if [ "$NODE_MISSING_SCOPE" != "external" ] || [ -z "${NODE_OPTIONS:-}" ]; then
    return 1
  fi

  log "Ignoring broken external NODE_OPTIONS preload for HappyTG bootstrap: $NODE_MISSING_PRELOAD. HappyTG does not manage this preload; bootstrap commands will continue with NODE_OPTIONS cleared."
  export HAPPYTG_BOOTSTRAP_IGNORED_NODE_OPTIONS="$NODE_OPTIONS"
  unset NODE_OPTIONS
  return 0
}

current_node_probe() {
  node_probe
  if use_bootstrap_safe_node_options; then
    node_probe
  fi
}

node_failure_message() {
  if [ -n "$NODE_MISSING_PRELOAD" ]; then
    case "$NODE_MISSING_SCOPE" in
      bootstrap)
        printf '%s\n' "Node.js is installed, but NODE_OPTIONS requires a missing preload inside HAPPYTG_BOOTSTRAP_DIR: $NODE_MISSING_PRELOAD. Repair the bootstrap checkout or clear NODE_OPTIONS, then rerun the installer."
        ;;
      workspace)
        printf '%s\n' "Node.js is installed, but NODE_OPTIONS requires a missing preload inside the selected workspace: $NODE_MISSING_PRELOAD. Repair that preload or clear NODE_OPTIONS, then rerun the installer."
        ;;
      *)
        printf '%s\n' "Node.js is installed, but an external NODE_OPTIONS preload is missing: $NODE_MISSING_PRELOAD. Clear or repair NODE_OPTIONS, then rerun the installer."
        ;;
    esac
    return
  fi

  printf '%s\n' "Node.js is installed, but it could not start cleanly in this shell. Clear or repair the local Node runtime settings, then rerun the installer.
$NODE_ERROR"
}

node_major() {
  current_node_probe
  printf '%s' "${NODE_MAJOR:-0}"
}

ensure_git() {
  if have_cmd git; then
    return
  fi

  case "$(uname -s)" in
    Darwin)
      if have_cmd brew; then
        log "Installing Git with Homebrew..."
        brew install git
        return
      fi
      fail "Git is missing. Install Xcode Command Line Tools or Homebrew, then rerun the installer."
      ;;
    Linux)
      if have_cmd apt-get; then
        log "Installing Git with apt-get..."
        run_root apt-get update
        run_root apt-get install -y git
        return
      fi
      if have_cmd dnf; then
        log "Installing Git with dnf..."
        run_root dnf install -y git
        return
      fi
      fail "Git is missing. Install Git with your distro package manager, then rerun the installer."
      ;;
    *)
      fail "Unsupported platform for install.sh."
      ;;
  esac
}

ensure_node() {
  current_node_probe
  if [ "${NODE_MAJOR:-0}" -ge 22 ]; then
    return
  fi

  if [ "${NODE_PRESENT:-0}" -eq 1 ] && [ -n "$NODE_ERROR" ]; then
    fail "$(node_failure_message)"
  fi

  case "$(uname -s)" in
    Darwin)
      if have_cmd brew; then
        log "Installing Node.js 22 with Homebrew..."
        brew install node@22
        return
      fi
      fail "Node.js 22+ is required. Install Homebrew or Node.js manually, then rerun the installer."
      ;;
    Linux)
      fail "Node.js 22+ is required to continue. Install Node.js 22+ manually for your distro, then rerun the installer."
      ;;
    *)
      fail "Unsupported platform for install.sh."
      ;;
  esac
}

ensure_pnpm() {
  if have_cmd pnpm; then
    return
  fi

  if have_cmd corepack; then
    log "Activating pnpm with corepack..."
    corepack enable
    corepack prepare pnpm@10.0.0 --activate
    return
  fi

  if have_cmd npm; then
    log "Installing pnpm globally..."
    npm install -g pnpm
    return
  fi

  fail "pnpm is required. Install it with npm or corepack, then rerun the installer."
}

sync_bootstrap_repo() {
  mkdir -p "$(dirname "$BOOTSTRAP_DIR")"

  if [ -d "$BOOTSTRAP_DIR/.git" ]; then
    log "Updating bootstrap checkout in $BOOTSTRAP_DIR..."
    git -C "$BOOTSTRAP_DIR" fetch --all --prune
    git -C "$BOOTSTRAP_DIR" checkout "$BRANCH"
    git -C "$BOOTSTRAP_DIR" pull --ff-only origin "$BRANCH"
    return
  fi

  rm -rf "$BOOTSTRAP_DIR"
  log "Cloning HappyTG bootstrap checkout into $BOOTSTRAP_DIR..."
  git clone --branch "$BRANCH" "$REPO_URL" "$BOOTSTRAP_DIR"
}

has_ignored_build_scripts_warning() {
  printf '%s\n' "$1" | grep -Eiq 'ignored build scripts:|build scripts that were ignored:'
}

pnpm_supports_approve_builds() {
  local help_output
  help_output="$(pnpm help approve-builds 2>&1 || true)"
  printf '%s\n' "$help_output" | grep -Fq 'No results for "approve-builds"' && return 1
  return 0
}

shared_installer_bootstrap_preflight() {
  local preflight_output status
  set +e
  preflight_output="$(pnpm dlx tsx --eval "const value: number = 1; console.log('${BOOTSTRAP_TOOLCHAIN_MARKER}')" 2>&1)"
  status=$?
  set -e

  if [ "$status" -ne 0 ]; then
    [ -n "$preflight_output" ] && printf '%s\n' "$preflight_output"
    fail "HappyTG installer bootstrap could not start through pnpm dlx tsx. Fix pnpm/tsx in this shell, then rerun the installer."
  fi

  printf '%s\n' "$preflight_output" | grep -Fq "$BOOTSTRAP_TOOLCHAIN_MARKER" || {
    [ -n "$preflight_output" ] && printf '%s\n' "$preflight_output"
    fail "HappyTG installer bootstrap did not confirm the repo-local tsx/esbuild preflight."
  }

  if has_ignored_build_scripts_warning "$preflight_output"; then
    if pnpm_supports_approve_builds; then
      log 'pnpm ignored build scripts while preparing the shared installer bootstrap, but the repo-local tsx/esbuild preflight passed. Continuing with the installer. If a later bootstrap dlx run fails, review the blocked scripts with `pnpm approve-builds` and rerun.'
    else
      log 'pnpm ignored build scripts while preparing the shared installer bootstrap, but the repo-local tsx/esbuild preflight passed. Continuing with the installer. This pnpm runtime does not support `pnpm approve-builds`; if a later bootstrap dlx run fails, allow the blocked packages in your pnpm build-script policy and rerun.'
    fi
  fi
}

run_shared_installer() {
  log "Handing off to the shared HappyTG installer..."
  cd "$BOOTSTRAP_DIR"
  shared_installer_bootstrap_preflight
  exec pnpm --silent dlx tsx packages/bootstrap/src/cli.ts install \
    --launch-cwd "$ORIGINAL_CWD" \
    --bootstrap-repo-root "$BOOTSTRAP_DIR" \
    --repo-url "$REPO_URL" \
    --branch "$BRANCH" \
    "$@"
}

ensure_git
have_cmd git || fail "Git is still not available on PATH. Open a new shell and rerun the installer."
ensure_node
current_node_probe
if [ "${NODE_MAJOR:-0}" -lt 22 ]; then
  if [ "${NODE_PRESENT:-0}" -eq 1 ] && [ -n "$NODE_ERROR" ]; then
    fail "$(node_failure_message)"
  fi

  if [ -n "$NODE_VERSION" ]; then
    fail "Node.js 22+ is still not available on PATH. Found $NODE_VERSION. Open a new shell and rerun the installer."
  fi

  fail "Node.js 22+ is still not available on PATH. Open a new shell and rerun the installer."
fi
ensure_pnpm
have_cmd pnpm || fail "pnpm is still not available on PATH. Open a new shell and rerun the installer."
sync_bootstrap_repo
run_shared_installer "$@"
