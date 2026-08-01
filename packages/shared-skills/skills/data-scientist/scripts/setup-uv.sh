#!/usr/bin/env bash
set -euo pipefail

log() { printf '[setup-uv] %s\n' "$*"; }

os="$(uname -s 2>/dev/null || echo unknown)"
arch="$(uname -m 2>/dev/null || echo unknown)"
log "detected os=${os} arch=${arch}"

case "$os" in
  Darwin|Linux) ;;
  MINGW*|MSYS*|CYGWIN*)
    log "Git Bash / MSYS environment detected - installing the Windows build is not supported here."
    log "Use the Linux installer inside WSL, or run scripts/setup-uv.ps1 in PowerShell instead."
    exit 1
    ;;
  *)
    log "unsupported OS: ${os} - see references/uv-setup.md for manual steps."
    exit 1
    ;;
esac

if command -v uv >/dev/null 2>&1; then
  current="$(uv --version 2>/dev/null | head -n1)"
  log "uv already installed (${current}) - upgrading"
  if uv self update >/dev/null 2>&1; then
    log "uv self update succeeded"
  else
    log "uv self update unavailable (package-manager install) - trying Homebrew"
    if command -v brew >/dev/null 2>&1; then
      brew upgrade uv >/dev/null 2>&1 || brew install uv
    else
      log "no Homebrew; keeping current uv (already functional)"
    fi
  fi
else
  log "uv not found - installing latest via the official installer"
  if command -v curl >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- https://astral.sh/uv/install.sh | sh
  elif command -v brew >/dev/null 2>&1; then
    log "no curl/wget - installing via Homebrew"
    brew install uv
  else
    log "neither curl, wget, nor brew available - install one of them and re-run."
    exit 1
  fi
fi

if ! command -v uv >/dev/null 2>&1; then
  export PATH="$HOME/.local/bin:$PATH"
fi

if ! command -v uv >/dev/null 2>&1; then
  log "FAIL: uv still not on PATH after install - add \$HOME/.local/bin to PATH and retry."
  exit 1
fi

log "OK: $(uv --version)"
