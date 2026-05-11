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
