#!/usr/bin/env bash
# Global installer for @fredostark/oh-my-opendevin
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

# Parse args
DO_UNINSTALL=false
DO_VERIFY=true
DO_HELP=false
for arg in "$@"; do
  case $arg in
    --uninstall) DO_UNLINK=true ;;
    --no-verify) DO_VERIFY=false ;;
    --help) DO_HELP=true ;;
    *) log_error "Unknown option: $arg"; exit 1 ;;
  esac
done

if [[ "$DO_HELP" == true ]]; then
  echo "Usage: $0 [--uninstall] [--no-verify] [--help]"
  echo "  --uninstall   Remove global installation and restore config"
  echo "  --no-verify   Skip verification step"
  echo "  --help        Show this help"
  exit 0
fi

# Handle uninstall
if [[ "${DO_UNLINK:-false}" == true ]]; then
  log_info "Uninstalling @fredostark/oh-my-opendevin..."
  
  # Uninstall from npm
  if command -v npm &> /dev/null; then
    npm uninstall -g @fredostark/oh-my-opendevin
    log_success "Uninstalled from npm"
  else
    log_warn "npm not found, skipping npm uninstall"
  fi
  
  # Remove from OpenCode config
  OPENCODE_CONFIG="$HOME/.config/opencode/opencode.json"
  if [[ ! -f "$OPENCODE_CONFIG" ]]; then
    OPENCODE_CONFIG="$HOME/.config/opencode/opencode.jsonc"
  fi
  
  if [[ -f "$OPENCODE_CONFIG" ]]; then
    if command -v jq &> /dev/null; then
      jq 'del(.plugin[] | select(. == "@fredostark/oh-my-opendevin"))' \
        "$OPENCODE_CONFIG" > /tmp/opencode.json.tmp && \
        mv /tmp/opencode.json.tmp "$OPENCODE_CONFIG"
      log_success "Removed from OpenCode config"
    else
      log_warn "jq not found. Please manually remove @fredostark/oh-my-opendevin from $OPENCODE_CONFIG"
    fi
  fi
  
  log_success "Uninstall complete. Restart OpenCode."
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

# Check for bun (recommended for development, but not required for runtime)
if command -v bun &> /dev/null; then
  log_success "bun found: $(bun --version)"
else
  log_warn "bun not found (optional, for development only)"
fi

# Step 2: Install package globally
log_info "Step 2: Installing @fredostark/oh-my-opendevin globally..."

if npm install -g @fredostark/oh-my-opendevin; then
  log_success "Package installed globally"
else
  log_error "Failed to install package globally"
  exit 1
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

# Check if package is in npm global list
if npm list -g @fredostark/oh-my-opendevin &> /dev/null; then
  log_success "Package verified in npm global packages"
else
  log_error "Package not found in npm global packages"
  exit 1
fi

# Step 4: Configure OpenCode
log_info "Step 4: Configuring OpenCode..."

OPENCODE_CONFIG="$HOME/.config/opencode/opencode.json"
if [[ ! -f "$OPENCODE_CONFIG" ]]; then
  OPENCODE_CONFIG="$HOME/.config/opencode/opencode.jsonc"
fi

if [[ ! -f "$OPENCODE_CONFIG" ]]; then
  log_warn "OpenCode config not found at ~/.config/opencode/opencode.json or opencode.jsonc"
  log_info "Creating new config file..."
  mkdir -p "$HOME/.config/opencode"
  echo '{"plugin": ["@fredostark/oh-my-opendevin"]}' > "$OPENCODE_CONFIG"
  log_success "Created new OpenCode config"
else
  if command -v jq &> /dev/null; then
    # Remove existing oh-my-opencode/oh-my-openagent entries to avoid conflicts
    jq 'del(.plugin[] | select(. == "oh-my-openagent" or . == "oh-my-opencode"))' \
      "$OPENCODE_CONFIG" > /tmp/opencode.json.tmp && \
      mv /tmp/opencode.json.tmp "$OPENCODE_CONFIG"
    
    # Add @fredostark/oh-my-opendevin
    jq '.plugin |= if any(.[]; . == "@fredostark/oh-my-opendevin") then . else ["@fredostark/oh-my-opendevin"] + . end' \
      "$OPENCODE_CONFIG" > /tmp/opencode.json.tmp && \
      mv /tmp/opencode.json.tmp "$OPENCODE_CONFIG"
    
    log_success "Updated OpenCode config"
  else
    log_warn "jq not found. Please manually edit $OPENCODE_CONFIG"
    log_warn 'Add "@fredostark/oh-my-opendevin" to the plugin array'
    log_warn 'Remove any existing "oh-my-openagent" or "oh-my-opencode" entries to avoid conflicts'
  fi
fi

# Step 5: Verification (optional)
if [[ "$DO_VERIFY" == true ]]; then
  log_info "Step 5: Running verification..."
  
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
echo "  2. Verify by checking for OmO agent availability"
echo ""
log_info "CLI commands available:"
echo "  - oh-my-opendevin (or oh-my-opencode)"
echo "  - oh-my-opendevin doctor"
echo "  - oh-my-opendevin install"
echo ""
log_info "To uninstall:"
echo "  $0 --uninstall"
echo ""
log_info "Documentation:"
echo "  https://github.com/fredotran/oh-my-opendevin"
