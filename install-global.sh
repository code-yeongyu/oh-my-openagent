#!/usr/bin/env bash
# Global installer for oh-my-opendevin
# This script installs the oh-my-opendevin fork globally on any system

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

# Install Bun if not present
install_bun() {
  log_info "Installing Bun..."
  
  # Check if curl is available
  if ! command -v curl &> /dev/null; then
    log_error "curl is required to install Bun but is not installed"
    return 1
  fi
  
  # Install Bun using the official installer
  # The installer automatically handles PATH setup
  if curl -fsSL https://bun.sh/install | bash; then
    # The bun installer adds itself to PATH in shell config files
    # We need to use the direct path for this session
    BUN_INSTALL_DIR="$HOME/.bun/bin"
    
    if [[ -d "$BUN_INSTALL_DIR" ]]; then
      export PATH="$BUN_INSTALL_DIR:$PATH"
      
      if command -v bun &> /dev/null; then
        log_success "Bun installed successfully: $(bun --version)"
        return 0
      else
        log_error "Bun installation completed but command not found at $BUN_INSTALL_DIR/bun"
        return 1
      fi
    else
      log_error "Bun installation directory not found at $BUN_INSTALL_DIR"
      return 1
    fi
  else
    log_error "Failed to install Bun via curl"
    return 1
  fi
}

# Parse args
DO_UNINSTALL=false
DO_VERIFY=true
DO_HELP=false
DO_FIX_MCP=false
for arg in "$@"; do
  case $arg in
    --uninstall) DO_UNLINK=true ;;
    --no-verify) DO_VERIFY=false ;;
    --fix-mcp) DO_FIX_MCP=true ;;
    --help) DO_HELP=true ;;
    *) log_error "Unknown option: $arg"; exit 1 ;;
  esac
done

if [[ "$DO_HELP" == true ]]; then
  echo "Usage: $0 [--uninstall] [--no-verify] [--fix-mcp] [--help]"
  echo "  --uninstall   Remove global installation and restore config"
  echo "  --no-verify   Skip verification step"
  echo "  --fix-mcp     Fix MCP configuration without reinstalling"
  echo "  --help        Show this help"
  exit 0
fi

# Handle uninstall
if [[ "${DO_UNLINK:-false}" == true ]]; then
  log_info "Uninstalling oh-my-opendevin..."

  # Try npm uninstall first
  if command -v npm &> /dev/null; then
    if npm uninstall -g oh-my-opendevin 2>/dev/null; then
      log_success "Uninstalled from npm"
    else
      log_warn "Package not in npm, trying symlink removal..."

      # Remove symlinks
      GLOBAL_MODULE_DIR="$HOME/.npm-global/lib/node_modules"
      GLOBAL_BIN_DIR="$HOME/.npm-global/bin"
      
      if [[ -L "$GLOBAL_MODULE_DIR/oh-my-opendevin" ]]; then
        rm "$GLOBAL_MODULE_DIR/oh-my-opendevin"
        log_success "Removed module symlink"
      fi
      
      if [[ -L "$GLOBAL_BIN_DIR/oh-my-opendevin" ]]; then
        rm "$GLOBAL_BIN_DIR/oh-my-opendevin"
        log_success "Removed binary symlink"
      fi
      
      if [[ -L "$GLOBAL_BIN_DIR/oh-my-opencode" ]]; then
        rm "$GLOBAL_BIN_DIR/oh-my-opencode"
        log_success "Removed oh-my-opencode binary symlink"
      fi
    fi
  else
    log_warn "npm not found, skipping uninstall"
  fi
  
  # Remove user-level MCP configuration and launcher
  USER_MCP_CONFIG="$HOME/.config/opencode/.mcp.json"
  if [[ -f "$USER_MCP_CONFIG" ]]; then
    if command -v jq &> /dev/null; then
      jq 'del(.mcpServers.devin)' "$USER_MCP_CONFIG" > /tmp/mcp.json.tmp && mv /tmp/mcp.json.tmp "$USER_MCP_CONFIG"
      log_success "Removed Devin MCP from user-level configuration"
    else
      log_warn "jq not found. Please manually remove Devin MCP from $USER_MCP_CONFIG"
    fi
  fi

  # Remove MCP launcher
  MCP_LAUNCHER="$HOME/.config/opencode/devin-mcp-launcher.sh"
  if [[ -f "$MCP_LAUNCHER" ]]; then
    rm "$MCP_LAUNCHER"
    log_success "Removed MCP launcher"
  fi

  # Remove from OpenCode config
  OPENCODE_CONFIG="$HOME/.config/opencode/opencode.json"
  if [[ ! -f "$OPENCODE_CONFIG" ]]; then
    OPENCODE_CONFIG="$HOME/.config/opencode/opencode.jsonc"
  fi
  
  if [[ -f "$OPENCODE_CONFIG" ]]; then
    if command -v jq &> /dev/null; then
      jq 'del(.plugin[] | select(. == "oh-my-opendevin"))' \
        "$OPENCODE_CONFIG" > /tmp/opencode.json.tmp && \
        mv /tmp/opencode.json.tmp "$OPENCODE_CONFIG"
      log_success "Removed from OpenCode config"
    else
      log_warn "jq not found. Please manually remove oh-my-opendevin from $OPENCODE_CONFIG"
    fi
  fi
  
  log_success "Uninstall complete. Restart OpenCode."
  exit 0
fi

# Handle --fix-mcp (standalone MCP repair without full reinstall)
if [[ "$DO_FIX_MCP" == true ]]; then
  log_info "Running MCP configuration fix..."

  # Check Bun
  if ! command -v bun &> /dev/null; then
    log_warn "Bun not found. MCP requires Bun."
    log_info "Installing Bun automatically..."
    if ! install_bun; then
      log_error "Failed to install Bun. Cannot fix MCP without Bun."
      exit 1
    fi
  fi
  log_success "Bun available: $(bun --version)"

  # Find the launcher in the installation
  LAUNCHER_SOURCE=""
  if npm list -g oh-my-opendevin &> /dev/null; then
    LAUNCHER_SOURCE="$(npm root -g)/oh-my-opendevin/bin/devin-mcp-launcher.sh"
  fi

  # Check local dirs
  if [[ -z "$LAUNCHER_SOURCE" ]]; then
    GLOBAL_MODULE_DIR="$HOME/.npm-global/lib/node_modules"
    if [[ -f "$GLOBAL_MODULE_DIR/oh-my-opendevin/bin/devin-mcp-launcher.sh" ]]; then
      LAUNCHER_SOURCE="$GLOBAL_MODULE_DIR/oh-my-opendevin/bin/devin-mcp-launcher.sh"
    fi
  fi

  # Check current directory
  if [[ -z "$LAUNCHER_SOURCE" ]] && [[ -f "bin/devin-mcp-launcher.sh" ]]; then
    LAUNCHER_SOURCE="$(pwd)/bin/devin-mcp-launcher.sh"
  fi

  if [[ -z "$LAUNCHER_SOURCE" ]] || [[ ! -f "$LAUNCHER_SOURCE" ]]; then
    log_error "MCP launcher not found in any installation."
    log_info "Please run the full installer first: ./install-global.sh"
    exit 1
  fi

  USER_MCP_CONFIG="$HOME/.config/opencode/.mcp.json"
  mkdir -p "$(dirname "$USER_MCP_CONFIG")"

  # Install launcher
  MCP_LAUNCHER="$HOME/.config/opencode/devin-mcp-launcher.sh"
  cp "$LAUNCHER_SOURCE" "$MCP_LAUNCHER"
  chmod +x "$MCP_LAUNCHER"
  log_success "Installed MCP launcher"

  # Check for old hardcoded-path configs
  NEEDS_FIX=false
  if [[ -f "$USER_MCP_CONFIG" ]]; then
    if grep -qE '"command":\s*"bun"' "$USER_MCP_CONFIG" 2>/dev/null; then
      NEEDS_FIX=true
      log_warn "Detected old hardcoded-path MCP config"
    fi
  fi

  # Write/Update MCP config
  if command -v jq &> /dev/null; then
    if [[ -f "$USER_MCP_CONFIG" ]]; then
      jq --arg launcher "$MCP_LAUNCHER" '.mcpServers.devin = {
        "type": "stdio",
        "command": "bash",
        "args": [$launcher],
        "env": {}
      }' "$USER_MCP_CONFIG" > /tmp/mcp.json.tmp && mv /tmp/mcp.json.tmp "$USER_MCP_CONFIG"
    else
      cat > "$USER_MCP_CONFIG" <<EOF
{
  "mcpServers": {
    "devin": {
      "type": "stdio",
      "command": "bash",
      "args": ["$MCP_LAUNCHER"],
      "env": {}
    }
  }
}
EOF
    fi
    log_success "MCP configuration updated"
  else
    log_warn "jq not found. Writing config directly..."
    cat > "$USER_MCP_CONFIG" <<EOF
{
  "mcpServers": {
    "devin": {
      "type": "stdio",
      "command": "bash",
      "args": ["$MCP_LAUNCHER"],
      "env": {}
    }
  }
}
EOF
    log_success "MCP configuration created"
  fi

  # Smoke test
  log_info "Testing MCP server startup..."
  SMOKE_OUTPUT=$(
    printf '%s\n' \
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"fix","version":"1.0"}}}' \
      '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
      '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' |
    timeout 5 bash "$MCP_LAUNCHER" 2>/dev/null | grep -o '"devin_start"' | head -1 || true
  )

  if [[ "$SMOKE_OUTPUT" == '"devin_start"' ]]; then
    log_success "MCP server starts correctly"
  else
    log_warn "MCP server test had issues"
  fi

  echo ""
  log_success "MCP fix complete!"
  log_info "Restart OpenCode to reload MCP servers."
  exit 0
fi

# Step 1: Check prerequisites
log_info "Step 1: Checking prerequisites..."

# Check for npm
if ! command -v npm &> /dev/null; then
  log_error "npm is not installed. Please install Node.js and npm first."
  log_info "Visit: https://nodejs.org/"
  exit 1
fi
log_success "npm found: $(npm --version)"

# Check for bun (required for MCP integration)
if command -v bun &> /dev/null; then
  log_success "bun found: $(bun --version)"
else
  log_warn "bun not found (required for MCP integration)"
  log_info "Installing Bun automatically..."
  if ! install_bun; then
    log_error "Failed to install Bun. MCP integration will not work without Bun."
    log_info "You can install Bun manually from https://bun.sh/"
    log_info "After installing Bun, re-run this script or configure MCP manually."
    SHOULD_SKIP_MCP=true
  fi
fi

# Step 2: Install package globally
log_info "Step 2: Installing oh-my-opendevin globally..."

# Try npm install first
if npm install -g oh-my-opendevin 2>/dev/null; then
  log_success "Package installed globally from npm"
else
  log_warn "Package not found on npm, trying local installation..."
  
  # Check if we're in the repository
  if [[ -f "package.json" ]] && [[ -f "src/index.ts" ]]; then
    log_info "Installing from local repository..."
    
    # Build the project
    if ! command -v bun &> /dev/null; then
      log_error "bun is required for local installation"
      log_error "Install bun from https://bun.sh/"
      exit 1
    fi
    
    log_info "Building project..."
    if bun run build > /dev/null 2>&1; then
      log_success "Build successful"
    else
      log_error "Build failed"
      bun run build
      exit 1
    fi
    
    # Create global symlink
    log_info "Creating global symlink..."

    # Use user-local directories to avoid permission issues
    GLOBAL_MODULE_DIR="$HOME/.npm-global/lib/node_modules"
    GLOBAL_BIN_DIR="$HOME/.npm-global/bin"

    # Create directories
    mkdir -p "$GLOBAL_MODULE_DIR"
    mkdir -p "$GLOBAL_BIN_DIR"

    # Create symlink to the dist directory
    ln -sf "$(pwd)/dist" "$GLOBAL_MODULE_DIR/oh-my-opendevin"

    # Create symlink for the binary
    ln -sf "$(pwd)/bin/oh-my-opencode.js" "$GLOBAL_BIN_DIR/oh-my-opendevin"
    ln -sf "$(pwd)/bin/oh-my-opencode.js" "$GLOBAL_BIN_DIR/oh-my-opencode"

    # Add to PATH if not already there
    if [[ ":$PATH:" != *":$GLOBAL_BIN_DIR:"* ]]; then
      log_warn "Adding $GLOBAL_BIN_DIR to PATH"
      echo "export PATH=\"$GLOBAL_BIN_DIR:\$PATH\"" >> ~/.bashrc
      log_warn "Please run: source ~/.bashrc"
    fi
    
    log_success "Local installation complete via symlink"
  else
    log_error "Not in repository directory and package not found on npm"
    log_error "Please run this script from the repository root or publish the package to npm first"
    exit 1
  fi
fi

# Step 3: Verify installation
log_info "Step 3: Verifying installation..."

if command -v oh-my-opendevin &> /dev/null; then
  log_success "CLI command available: oh-my-opendevin"
elif command -v oh-my-opencode &> /dev/null; then
  log_success "CLI command available: oh-my-opencode"
else
  log_warn "CLI command not found in PATH (may need to restart shell)"
fi

# Check if package is in npm global list or symlink exists
if npm list -g oh-my-opendevin &> /dev/null; then
  log_success "Package verified in npm global packages"
else
  GLOBAL_MODULE_DIR="$HOME/.npm-global/lib/node_modules"

  if [[ -L "$GLOBAL_MODULE_DIR/oh-my-opendevin" ]]; then
    log_success "Package verified as local symlink"
  else
    log_error "Package not found in npm global packages or as symlink"
    exit 1
  fi
fi

# Step 4: Configure MCP servers
log_info "Step 4: Configuring MCP servers..."

if [[ "${SHOULD_SKIP_MCP:-false}" == true ]]; then
  log_warn "Skipping MCP configuration due to missing Bun"
  log_info "MCP integration requires Bun. Install Bun from https://bun.sh/ and re-run this script."
else

# Install the MCP launcher to a stable location
log_info "Installing MCP launcher..."

# Find the launcher in the installation
LAUNCHER_SOURCE=""
if npm list -g oh-my-opendevin &> /dev/null; then
  LAUNCHER_SOURCE="$(npm root -g)/oh-my-opendevin/bin/devin-mcp-launcher.sh"
elif [[ -f "$GLOBAL_MODULE_DIR/oh-my-opendevin/bin/devin-mcp-launcher.sh" ]]; then
  LAUNCHER_SOURCE="$GLOBAL_MODULE_DIR/oh-my-opendevin/bin/devin-mcp-launcher.sh"
fi

# Also check current directory (for local installation)
if [[ -z "$LAUNCHER_SOURCE" ]] && [[ -f "bin/devin-mcp-launcher.sh" ]]; then
  LAUNCHER_SOURCE="$(pwd)/bin/devin-mcp-launcher.sh"
fi

USER_MCP_CONFIG="$HOME/.config/opencode/.mcp.json"
mkdir -p "$(dirname "$USER_MCP_CONFIG")"

if [[ -n "$LAUNCHER_SOURCE" ]] && [[ -f "$LAUNCHER_SOURCE" ]]; then
  # Copy launcher to stable location
  MCP_LAUNCHER="$HOME/.config/opencode/devin-mcp-launcher.sh"
  cp "$LAUNCHER_SOURCE" "$MCP_LAUNCHER"
  chmod +x "$MCP_LAUNCHER"
  log_success "Installed MCP launcher to $MCP_LAUNCHER"

  if [[ ! -f "$USER_MCP_CONFIG" ]]; then
    log_info "Creating user-level MCP configuration..."

    cat > "$USER_MCP_CONFIG" <<EOF
{
  "mcpServers": {
    "devin": {
      "type": "stdio",
      "command": "bash",
      "args": ["$MCP_LAUNCHER"],
      "env": {}
    }
  }
}
EOF

    log_success "Created user-level MCP configuration"
  else
    log_info "Updating existing user-level MCP configuration..."

    if command -v jq &> /dev/null; then
      jq --arg launcher "$MCP_LAUNCHER" '.mcpServers.devin = {
        "type": "stdio",
        "command": "bash",
        "args": [$launcher],
        "env": {}
      }' "$USER_MCP_CONFIG" > /tmp/mcp.json.tmp && mv /tmp/mcp.json.tmp "$USER_MCP_CONFIG"
      log_success "Updated user-level MCP configuration"
    else
      log_warn "jq not found. Please manually update Devin MCP in $USER_MCP_CONFIG"
      log_warn "Set devin server to:"
      echo "  {"
      echo "    \"type\": \"stdio\","
      echo "    \"command\": \"bash\","
      echo "    \"args\": [\"$MCP_LAUNCHER\"],"
      echo "    \"env\": {}"
      echo "  }"
    fi
  fi
else
  log_warn "MCP launcher not found in installation. MCP configuration may not work correctly."
  log_info "If MCP tools don't appear, run: ./install-global.sh --fix-mcp"
fi

# Smoke test the MCP server after configuration
if [[ -f "$MCP_LAUNCHER" ]] && [[ -x "$MCP_LAUNCHER" ]]; then
  log_info "Testing MCP server startup..."
  local smoke_output
  smoke_output=$(
    printf '%s\n' \
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"install","version":"1.0"}}}' \
      '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
      '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' |
    timeout 5 bash "$MCP_LAUNCHER" 2>/dev/null | grep -o '"devin_start"' | head -1 || true
  )

  if [[ "$smoke_output" == '"devin_start"' ]]; then
    log_success "MCP server smoke test passed"
  else
    log_warn "MCP server smoke test failed"
    log_info "Devin tools may not appear in OpenCode. Try: ./install-global.sh --fix-mcp"
  fi
fi
fi  # End of SHOULD_SKIP_MCP check

# Step 5: Configure OpenCode
log_info "Step 5: Configuring OpenCode..."

OPENCODE_CONFIG="$HOME/.config/opencode/opencode.json"
if [[ ! -f "$OPENCODE_CONFIG" ]]; then
  OPENCODE_CONFIG="$HOME/.config/opencode/opencode.jsonc"
fi

if [[ ! -f "$OPENCODE_CONFIG" ]]; then
  log_warn "OpenCode config not found at ~/.config/opencode/opencode.json or opencode.jsonc"
  log_info "Creating new config file..."
  mkdir -p "$HOME/.config/opencode"
  echo '{"plugin": ["oh-my-opendevin"]}' > "$OPENCODE_CONFIG"
  log_success "Created new OpenCode config"
else
  if command -v jq &> /dev/null; then
    # Remove existing oh-my-opencode/oh-my-openagent entries to avoid conflicts
    jq 'del(.plugin[] | select(. == "oh-my-openagent" or . == "oh-my-opencode"))' \
      "$OPENCODE_CONFIG" > /tmp/opencode.json.tmp && \
      mv /tmp/opencode.json.tmp "$OPENCODE_CONFIG"
    
    # Add oh-my-opendevin
    jq '.plugin |= if any(.[]; . == "oh-my-opendevin") then . else ["oh-my-opendevin"] + . end' \
      "$OPENCODE_CONFIG" > /tmp/opencode.json.tmp && \
      mv /tmp/opencode.json.tmp "$OPENCODE_CONFIG"
    
    log_success "Updated OpenCode config"
  else
    log_warn "jq not found. Please manually edit $OPENCODE_CONFIG"
    log_warn 'Add "oh-my-opendevin" to the plugin array'
    log_warn 'Remove any existing "oh-my-openagent" or "oh-my-opencode" entries to avoid conflicts'
  fi
fi

# Step 6: Verification (optional)
if [[ "$DO_VERIFY" == true ]]; then
  log_info "Step 6: Running verification..."
  
  if command -v oh-my-opendevin &> /dev/null; then
    if oh-my-opendevin doctor &> /tmp/omo-doctor.log 2>&1; then
      log_success "Doctor check passed"
    else
      log_warn "Doctor check had issues. Check /tmp/omo-doctor.log for details"
    fi
  elif command -v oh-my-opencode &> /dev/null; then
    if oh-my-opencode doctor &> /tmp/omo-doctor.log 2>&1; then
      log_success "Doctor check passed"
    else
      log_warn "Doctor check had issues. Check /tmp/omo-doctor.log for details"
    fi
  else
    log_warn "CLI command not available, skipping doctor check"
  fi
fi

# Step 6: Instructions
log_success "Installation complete!"
echo ""
log_info "Next steps:"
echo "  1. Restart OpenCode to load the plugin"
echo "  2. Run ./check-installation.sh to verify all components"
echo "  3. Verify by checking for OmO agent availability"
echo ""
log_info "CLI commands available:"
echo "  - oh-my-opendevin (or oh-my-opencode)"
echo "  - oh-my-opendevin doctor"
echo "  - oh-my-opendevin install"
echo ""
log_info "Verification & Repair:"
echo "  - ./check-installation.sh          # Quick diagnostic"
echo "  - ./install-global.sh --fix-mcp    # Fix MCP if tools don't appear"
echo ""
log_info "To uninstall:"
echo "  curl -fsSL https://raw.githubusercontent.com/fredotran/oh-my-opendevin/dev/install-global.sh | bash -s --uninstall"
echo ""
log_info "Or download and run:"
echo "  curl -fsSL https://raw.githubusercontent.com/fredotran/oh-my-opendevin/dev/install-global.sh -o install-global.sh"
echo "  ./install-global.sh --uninstall"
echo ""
log_info "Documentation:"
echo "  https://github.com/fredotran/oh-my-opendevin"
