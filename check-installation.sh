#!/usr/bin/env bash
# Installation verification script for oh-my-opendevin
# Run this after installation to verify everything is configured correctly

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[PASS]${NC} $1"; }
log_error() { echo -e "${RED}[FAIL]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Counters
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

pass() {
  log_success "$1"
  ((PASS_COUNT++)) || true
}

fail() {
  log_error "$1"
  ((FAIL_COUNT++)) || true
}

warn() {
  log_warn "$1"
  ((WARN_COUNT++)) || true
}

print_header() {
  echo ""
  echo "========================================"
  echo "  oh-my-opendevin Installation Check"
  echo "========================================"
  echo ""
}

print_summary() {
  echo ""
  echo "========================================"
  echo "              Summary"
  echo "========================================"
  echo -e "  ${GREEN}${PASS_COUNT} passed${NC}"
  echo -e "  ${YELLOW}${WARN_COUNT} warnings${NC}"
  echo -e "  ${RED}${FAIL_COUNT} failed${NC}"
  echo ""

  if [[ $FAIL_COUNT -eq 0 ]]; then
    echo -e "${GREEN}Installation looks good!${NC}"
    if [[ $WARN_COUNT -gt 0 ]]; then
      echo -e "${YELLOW}Review warnings above for optional improvements.${NC}"
    fi
    return 0
  else
    echo -e "${RED}Installation has issues. Review failures above.${NC}"
    echo ""
    echo "Common fixes:"
    echo "  - Bun not found: curl -fsSL https://bun.sh/install | bash"
    echo "  - Plugin not in OpenCode: edit ~/.config/opencode/opencode.json"
    echo "  - MCP not configured: run ./install-global.sh again"
    return 1
  fi
}

# =============================================================================
# CHECK 1: Bun Installation
# =============================================================================
check_bun() {
  log_info "Checking Bun installation..."

  if command -v bun &> /dev/null; then
    BUN_VERSION=$(bun --version)
    pass "Bun installed: ${BUN_VERSION}"
  else
    fail "Bun not found in PATH"
    log_info "Install Bun: curl -fsSL https://bun.sh/install | bash"
    log_info "Then restart your shell or run: export PATH=\$HOME/.bun/bin:\$PATH"
  fi
}

# =============================================================================
# CHECK 2: npm Package Installation
# =============================================================================
check_npm_package() {
  log_info "Checking npm package installation..."

  # Check if installed globally via npm
  if npm list -g oh-my-opendevin &> /dev/null; then
    NPM_VERSION=$(npm list -g oh-my-opendevin --depth=0 2>/dev/null | grep oh-my-opendevin | sed 's/.*@//')
    pass "npm package installed: ${NPM_VERSION}"
    return
  fi

  # Check if installed via local symlink
  GLOBAL_MODULE_DIR="$HOME/.npm-global/lib/node_modules"
  if [[ -L "$GLOBAL_MODULE_DIR/oh-my-opendevin" ]]; then
    pass "Local symlink installation found"
    return
  fi

  # Check if we're in the repo with dist built
  if [[ -f "package.json" ]] && [[ -d "dist" ]]; then
    warn "Running from local repository (not globally installed)"
    log_info "To install globally, run: ./install-global.sh"
    return
  fi

  fail "oh-my-opendevin not installed globally"
  log_info "Install with: npm install -g oh-my-opendevin"
  log_info "Or run: ./install-global.sh"
}

# =============================================================================
# CHECK 3: CLI Commands Available
# =============================================================================
check_cli_commands() {
  log_info "Checking CLI commands..."

  local found_cmd=""

  if command -v oh-my-opendevin &> /dev/null; then
    found_cmd="oh-my-opendevin"
  elif command -v oh-my-opencode &> /dev/null; then
    found_cmd="oh-my-opencode"
  fi

  if [[ -n "$found_cmd" ]]; then
    pass "CLI command available: ${found_cmd}"
  else
    fail "No CLI command found (oh-my-opendevin or oh-my-opencode)"
    log_info "Ensure ~/.npm-global/bin is in your PATH"
  fi
}

# =============================================================================
# CHECK 4: MCP Server Files
# =============================================================================
check_mcp_server_files() {
  log_info "Checking MCP server files..."

  # Determine the installation path
  local mcp_server_path=""

  if npm list -g oh-my-opendevin &> /dev/null; then
    mcp_server_path="$(npm root -g)/oh-my-opendevin/dist/mcp-servers/devin/index.js"
  else
    GLOBAL_MODULE_DIR="$HOME/.npm-global/lib/node_modules"
    mcp_server_path="$GLOBAL_MODULE_DIR/oh-my-opendevin/dist/mcp-servers/devin/index.js"
  fi

  # Also check local repo fallback
  if [[ -f "dist/mcp-servers/devin/index.js" ]]; then
    mcp_server_path="$(pwd)/dist/mcp-servers/devin/index.js"
  fi

  if [[ -f "$mcp_server_path" ]]; then
    pass "MCP server file exists"
  else
    fail "MCP server file not found at: ${mcp_server_path}"
    log_info "Run: bun run build (if in the repo)"
    log_info "Or reinstall: ./install-global.sh"
  fi
}

# =============================================================================
# CHECK 4b: MCP Launcher
# =============================================================================
check_mcp_launcher() {
  log_info "Checking MCP launcher..."

  local launcher="$HOME/.config/opencode/devin-mcp-launcher.sh"

  if [[ -f "$launcher" ]]; then
    pass "MCP launcher installed at ${launcher}"
  else
    warn "MCP launcher not found (may use direct path instead)"
    log_info "Run ./install-global.sh --fix-mcp for the most robust configuration"
  fi
}

# =============================================================================
# CHECK 5: MCP Configuration
# =============================================================================
check_mcp_config() {
  log_info "Checking MCP configuration..."

  local mcp_config="$HOME/.claude/.mcp.json"
  local old_mcp_config="$HOME/.config/opencode/.mcp.json"

  # Warn about legacy location
  if [[ -f "$old_mcp_config" ]]; then
    if grep -q "devin" "$old_mcp_config" 2>/dev/null; then
      warn "Legacy MCP config found at ${old_mcp_config} — the plugin reads from ~/.claude/.mcp.json"
      log_info "Run: ./install-global.sh --fix-mcp to migrate to the correct location"
    fi
  fi

  if [[ ! -f "$mcp_config" ]]; then
    fail "MCP config not found at ${mcp_config}"
    log_info "Run: ./install-global.sh to configure MCP"
    return
  fi

  if grep -q "devin" "$mcp_config" 2>/dev/null; then
    pass "MCP config contains devin server entry"
  else
    fail "MCP config exists but missing devin server"
    log_info "Run: ./install-global.sh to reconfigure MCP"
  fi
}

# =============================================================================
# CHECK 6: OpenCode Plugin Configuration
# =============================================================================
check_opencode_plugin() {
  log_info "Checking OpenCode plugin configuration..."

  local opencode_config="$HOME/.config/opencode/opencode.json"
  local opencode_config_jsonc="$HOME/.config/opencode/opencode.jsonc"

  local config_file=""

  if [[ -f "$opencode_config_jsonc" ]]; then
    config_file="$opencode_config_jsonc"
  elif [[ -f "$opencode_config" ]]; then
    config_file="$opencode_config"
  else
    fail "OpenCode config not found"
    log_info "Expected at: ~/.config/opencode/opencode.json"
    return
  fi

  if grep -q "oh-my-opendevin" "$config_file" 2>/dev/null; then
    pass "Plugin configured in OpenCode"
  else
    fail "Plugin not found in OpenCode config"
    log_info "Add to ${config_file}: {\"plugin\": [\"oh-my-opendevin\"]}"
  fi
}

# =============================================================================
# CHECK 7: MCP Server Can Start (Smoke Test)
# =============================================================================
check_mcp_server_smoke() {
  log_info "Running MCP server smoke test..."

  local launcher="$HOME/.config/opencode/devin-mcp-launcher.sh"
  local run_cmd=""

  # Prefer launcher if available (most robust)
  if [[ -f "$launcher" ]]; then
    run_cmd="bash $launcher"
  else
    # Fallback to direct path
    local mcp_server_path=""
    if npm list -g oh-my-opendevin &> /dev/null; then
      mcp_server_path="$(npm root -g)/oh-my-opendevin/dist/mcp-servers/devin/index.js"
    else
      GLOBAL_MODULE_DIR="$HOME/.npm-global/lib/node_modules"
      mcp_server_path="$GLOBAL_MODULE_DIR/oh-my-opendevin/dist/mcp-servers/devin/index.js"
    fi
    if [[ -f "dist/mcp-servers/devin/index.js" ]]; then
      mcp_server_path="$(pwd)/dist/mcp-servers/devin/index.js"
    fi
    if [[ ! -f "$mcp_server_path" ]]; then
      warn "Cannot run smoke test - MCP server file not found"
      return
    fi
    run_cmd="bun run $mcp_server_path"
  fi

  # Run a quick smoke test with timeout
  local smoke_output
  smoke_output=$(
    printf '%s\n' \
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"check","version":"1.0"}}}' \
      '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
      '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' |
    timeout 5 bash -c "$run_cmd" 2>/dev/null | grep -o '"devin_start"' | head -1 || true
  )

  if [[ "$smoke_output" == '"devin_start"' ]]; then
    pass "MCP server smoke test passed (devin_start tool available)"
  else
    fail "MCP server smoke test failed"
    log_info "Check that Bun is working: bun --version"
    log_info "Try rebuilding: bun run build"
  fi
}

# =============================================================================
# CHECK 8: Run Doctor Command
# =============================================================================
check_doctor() {
  log_info "Running doctor check..."

  local doctor_cmd=""

  if command -v oh-my-opendevin &> /dev/null; then
    doctor_cmd="oh-my-opendevin"
  elif command -v oh-my-opencode &> /dev/null; then
    doctor_cmd="oh-my-opencode"
  fi

  if [[ -z "$doctor_cmd" ]]; then
    warn "Cannot run doctor - CLI command not found"
    return
  fi

  if "$doctor_cmd" doctor &> /tmp/omo-doctor-check.log; then
    pass "Doctor check passed"
  else
    warn "Doctor check had issues (see /tmp/omo-doctor-check.log)"
    # Show relevant lines from doctor output
    if [[ -f /tmp/omo-doctor-check.log ]]; then
      grep -E "(FAIL|WARN|error)" /tmp/omo-doctor-check.log | head -5 || true
    fi
  fi
}

# =============================================================================
# MAIN
# =============================================================================
main() {
  print_header

  check_bun
  check_npm_package
  check_cli_commands
  check_mcp_server_files
  check_mcp_launcher
  check_mcp_config
  check_opencode_plugin
  check_mcp_server_smoke
  check_doctor

  print_summary
}

main "$@"
