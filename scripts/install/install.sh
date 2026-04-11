#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${HAPPYTG_REPO_URL:-https://github.com/GermanMik/HappyTG.git}"
BRANCH="${HAPPYTG_INSTALL_BRANCH:-main}"
ORIGINAL_CWD="${PWD}"
BOOTSTRAP_DIR="${HAPPYTG_BOOTSTRAP_DIR:-${HOME}/.happytg/bootstrap-repo}"

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

run_root() {
  if have_cmd sudo; then
    sudo "$@"
    return
  fi

  "$@"
}

node_major() {
  if ! have_cmd node; then
    printf '0'
    return
  fi

  node -p "process.versions.node.split('.')[0]" 2>/dev/null || printf '0'
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
  if [ "$(node_major)" -ge 22 ]; then
    return
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

run_shared_installer() {
  log "Handing off to the shared HappyTG installer..."
  cd "$BOOTSTRAP_DIR"
  exec pnpm dlx tsx packages/bootstrap/src/cli.ts install \
    --launch-cwd "$ORIGINAL_CWD" \
    --bootstrap-repo-root "$BOOTSTRAP_DIR" \
    --repo-url "$REPO_URL" \
    --branch "$BRANCH" \
    "$@"
}

ensure_git
have_cmd git || fail "Git is still not available on PATH. Open a new shell and rerun the installer."
ensure_node
[ "$(node_major)" -ge 22 ] || fail "Node.js 22+ is still not available on PATH. Open a new shell and rerun the installer."
ensure_pnpm
have_cmd pnpm || fail "pnpm is still not available on PATH. Open a new shell and rerun the installer."
sync_bootstrap_repo
run_shared_installer "$@"
