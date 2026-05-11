#!/usr/bin/env bash
# Devin MCP Server Launcher
# Dynamically resolves the oh-my-opendevin installation path and runs the MCP server.
# This wrapper ensures the MCP config works across npm installs, local symlinks,
# and different shell environments.

set -euo pipefail

# Resolve the oh-my-opendevin installation directory
resolve_omo_path() {
  local paths_to_try=()

  # Try npm global first
  if command -v npm &> /dev/null; then
    local npm_global
    npm_global="$(npm root -g 2>/dev/null)/oh-my-opendevin" || true
    if [[ -d "$npm_global" ]]; then
      paths_to_try+=("$npm_global")
    fi
  fi

  # Try local symlink directories
  local symlink_dirs=(
    "$HOME/.npm-global/lib/node_modules/oh-my-opendevin"
    "$HOME/.local/share/pnpm/global/5/node_modules/oh-my-opendevin"
    "$HOME/Library/pnpm/global/5/node_modules/oh-my-opendevin"
  )
  for dir in "${symlink_dirs[@]}"; do
    if [[ -d "$dir" ]]; then
      paths_to_try+=("$dir")
    fi
  done

  # Try to find via the CLI command (resolves through symlinks)
  if command -v oh-my-opendevin &> /dev/null; then
    local cli_path
    cli_path="$(command -v oh-my-opendevin)"
    if [[ -L "$cli_path" ]]; then
      cli_path="$(readlink -f "$cli_path" 2>/dev/null || readlink "$cli_path" 2>/dev/null || echo "$cli_path")"
    fi
    # CLI is at bin/oh-my-opencode.js, package is the parent of bin/
    local pkg_dir
    pkg_dir="$(cd "$(dirname "$cli_path")/.." 2>/dev/null && pwd || true)"
    if [[ -d "$pkg_dir/dist" ]]; then
      paths_to_try+=("$pkg_dir")
    fi
  fi

  # Check each candidate for the MCP server file
  for path in "${paths_to_try[@]}"; do
    local mcp_file="$path/dist/mcp-servers/devin/index.js"
    if [[ -f "$mcp_file" ]]; then
      echo "$path"
      return 0
    fi
  done

  return 1
}

# Ensure bun is available
ensure_bun() {
  if command -v bun &> /dev/null; then
    return 0
  fi

  # Try common bun installation paths
  local bun_paths=(
    "$HOME/.bun/bin/bun"
    "/usr/local/bin/bun"
    "/opt/homebrew/bin/bun"
  )
  for bun_path in "${bun_paths[@]}"; do
    if [[ -x "$bun_path" ]]; then
      export PATH="$(dirname "$bun_path"):$PATH"
      return 0
    fi
  done

  echo "[devin-mcp-launcher] ERROR: Bun not found. Please install Bun:" >&2
  echo "  curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
}

main() {
  ensure_bun

  local omo_path
  if ! omo_path="$(resolve_omo_path)"; then
    echo "[devin-mcp-launcher] ERROR: Could not find oh-my-opendevin installation." >&2
    echo "  Is oh-my-opendevin installed? Try:" >&2
    echo "    npm install -g oh-my-opendevin" >&2
    echo "    # or run ./install-global.sh" >&2
    exit 1
  fi

  local mcp_server="$omo_path/dist/mcp-servers/devin/index.js"

  if [[ ! -f "$mcp_server" ]]; then
    echo "[devin-mcp-launcher] ERROR: MCP server file not found at $mcp_server" >&2
    exit 1
  fi

  exec bun run "$mcp_server"
}

main "$@"
