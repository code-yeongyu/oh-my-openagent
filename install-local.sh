#!/usr/bin/env bash
# Local development installation script for oh-my-opendevin
# Usage: ./install-local.sh [--help] [--unlink] [--verify] [--install]

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse args
DO_UNLINK=false
DO_VERIFY=true
DO_INSTALL=false
for arg in "$@"; do
  case $arg in
    --unlink) DO_UNLINK=true ;;
    --no-verify) DO_VERIFY=false ;;
    --install) DO_INSTALL=true ;;
    --help)
      echo "Usage: $0 [--unlink] [--no-verify] [--install] [--help]"
      echo "  --unlink     Remove local plugin and restore npm version"
      echo "  --no-verify  Skip verification step"
      echo "  --install    Install script to ~/.local/bin for global use"
      echo "  --help       Show this help"
      exit 0
      ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# Handle install
if [[ "$DO_INSTALL" == true ]]; then
  INSTALL_DIR="${HOME}/.local/bin"
  mkdir -p "$INSTALL_DIR"
  SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  cp "$SCRIPT_PATH" "$INSTALL_DIR/install-opencode-local"
  chmod +x "$INSTALL_DIR/install-opencode-local"
  echo -e "${GREEN}[INSTALL]${NC} Script installed to $INSTALL_DIR/install-opencode-local"
  echo -e "${BLUE}[INFO]${NC} Add $INSTALL_DIR to your PATH if not already present"
  exit 0
fi

# Helper functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[PASS]${NC} $1"; }
log_error() { echo -e "${RED}[FAIL]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Use fixed path for global installation
# Can be overridden with PROJECT_ROOT environment variable
if [[ -z "${PROJECT_ROOT:-}" ]]; then
  PROJECT_ROOT="/home/frederichtran199/Code/oh-my-opendevin"
fi

if [[ ! -f "$PROJECT_ROOT/package.json" ]] || [[ ! -f "$PROJECT_ROOT/src/index.ts" ]]; then
  log_error "Project root not found at $PROJECT_ROOT"
  log_error "Set PROJECT_ROOT environment variable to the correct path, or ensure the symlink exists"
  exit 1
fi

log_info "Project root: $PROJECT_ROOT"

# Handle unlink mode
if [[ "$DO_UNLINK" == true ]]; then
  log_info "Unlinking local plugin and restoring npm version..."
  
  OPENCODE_CONFIG="$HOME/.config/opencode/opencode.json"
  if [[ ! -f "$OPENCODE_CONFIG" ]]; then
    OPENCODE_CONFIG="$HOME/.config/opencode/opencode.jsonc"
  fi
  
  if [[ ! -f "$OPENCODE_CONFIG" ]]; then
    log_error "OpenCode config not found at ~/.config/opencode/opencode.json or opencode.jsonc"
    exit 1
  fi
  
  # Remove file:// plugin entry and add oh-my-openagent
  if command -v jq &> /dev/null; then
    jq 'del(.plugin[] | select(startswith("file://"))) | .plugin |= (if . == [] then ["oh-my-openagent"] else if any(.[]; . == "oh-my-openagent") then . else . + ["oh-my-openagent"] end end)' \
      "$OPENCODE_CONFIG" > /tmp/opencode.json.tmp && \
      mv /tmp/opencode.json.tmp "$OPENCODE_CONFIG"
    log_success "Removed local plugin entry from config"
  else
    log_warn "jq not found. Please manually edit $OPENCODE_CONFIG"
    log_warn "Remove the file:// entry and add \"oh-my-openagent\" to the plugin array"
  fi
  
  log_success "Unlinked. Restart OpenCode to load npm version."
  exit 0
fi

# Check if bun is available
if ! command -v bun &> /dev/null; then
  log_error "bun is not installed. Please install it first: https://bun.sh"
  exit 1
fi

# Step 1: Build the project
log_info "Step 1: Building project..."
cd "$PROJECT_ROOT"
if bun run build > /dev/null 2>&1; then
  log_success "Build successful"
else
  log_error "Build failed"
  bun run build
  exit 1
fi

# Step 2: Check if dist/index.js exists
log_info "Step 2: Checking build output..."
if [[ ! -f "$PROJECT_ROOT/dist/index.js" ]]; then
  log_error "Build output not found at $PROJECT_ROOT/dist/index.js"
  exit 1
fi
log_success "Build output found"

# Step 3: Update OpenCode config
log_info "Step 3: Updating OpenCode config..."

OPENCODE_CONFIG="$HOME/.config/opencode/opencode.json"
if [[ ! -f "$OPENCODE_CONFIG" ]]; then
  OPENCODE_CONFIG="$HOME/.config/opencode/opencode.jsonc"
fi

if [[ ! -f "$OPENCODE_CONFIG" ]]; then
  log_error "OpenCode config not found at ~/.config/opencode/opencode.json or opencode.jsonc"
  exit 1
fi

LOCAL_PLUGIN_URI="file://$PROJECT_ROOT/dist/index.js"

if command -v jq &> /dev/null; then
  # Remove existing oh-my-openagent/oh-my-opencode entries
  jq 'del(.plugin[] | select(. == "oh-my-openagent" or . == "oh-my-opencode"))' \
    "$OPENCODE_CONFIG" > /tmp/opencode.json.tmp && \
    mv /tmp/opencode.json.tmp "$OPENCODE_CONFIG"
  
  # Add local file:// entry
  jq --arg uri "$LOCAL_PLUGIN_URI" '.plugin |= if any(.[]; . == $uri) then . else [$uri] + . end' \
    "$OPENCODE_CONFIG" > /tmp/opencode.json.tmp && \
    mv /tmp/opencode.json.tmp "$OPENCODE_CONFIG"
  
  log_success "Config updated: plugin array now contains $LOCAL_PLUGIN_URI"
else
  log_warn "jq not found. Please manually edit $OPENCODE_CONFIG"
  log_warn "Replace the plugin array with:"
  echo '  "plugin": ["'"$LOCAL_PLUGIN_URI"'"]'
  log_warn "Make sure to remove any existing oh-my-openagent or oh-my-opencode entries"
fi

# Step 4: Verification (optional)
if [[ "$DO_VERIFY" == true ]]; then
  log_info "Step 4: Running verification..."
  
  if command -v bunx &> /dev/null; then
    if bunx oh-my-openagent doctor > /tmp/omo-doctor.log 2>&1; then
      log_success "Doctor check passed"
    else
      # Check if the only issue is plugin registration (expected for local dev)
      ISSUE_COUNT=$(grep -c "^[0-9]\." /tmp/omo-doctor.log 2>/dev/null || echo "0")
      if [[ "$ISSUE_COUNT" == "1" ]] && grep -q "oh-my-openagent is not registered" /tmp/omo-doctor.log; then
        log_warn "Doctor check: plugin not registered (expected for local file:// URI)"
        log_warn "This is normal for local development. The plugin will load correctly."
      else
        log_warn "Doctor check had issues. Check /tmp/omo-doctor.log for details"
      fi
    fi
  else
    log_warn "bunx not found, skipping doctor verification"
  fi
fi

# Step 5: Instructions
log_success "Local installation complete!"
echo ""
log_info "Next steps:"
echo "  1. Restart OpenCode to load the local plugin"
echo "  2. Verify by checking for OmO agent availability"
echo ""
log_info "To uninstall and restore npm version:"
echo "  $0 --unlink"
echo ""
log_info "After making code changes, rebuild:"
echo "  cd $PROJECT_ROOT && bun run build"
echo "  # Then restart OpenCode"
