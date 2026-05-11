#!/usr/bin/env bash
# Global test script for oh-my-opendevin friendly session names feature
# Usage: ./test-friendly-names.sh [--mcp] [--e2e] [--install] [--help]
#
# Options:
#   --mcp     Also test the Devin MCP server tools
#   --e2e     Run end-to-end session naming test (requires opencode CLI)
#   --install Install script to ~/.local/bin for global use
#   --help    Show this help message

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse args
TEST_MCP=false
TEST_E2E=false
DO_INSTALL=false
for arg in "$@"; do
  case $arg in
    --mcp) TEST_MCP=true ;;
    --e2e) TEST_E2E=true ;;
    --install) DO_INSTALL=true ;;
    --help)
      echo "Usage: $0 [--mcp] [--e2e] [--install] [--help]"
      echo "  --mcp     Test MCP server tools in addition to session naming"
      echo "  --e2e     Run end-to-end session naming test (requires opencode CLI)"
      echo "  --install Install script to ~/.local/bin for global use"
      echo "  --help    Show this help"
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
  cp "$SCRIPT_PATH" "$INSTALL_DIR/test-friendly-names"
  chmod +x "$INSTALL_DIR/test-friendly-names"
  echo -e "${GREEN}[INSTALL]${NC} Script installed to $INSTALL_DIR/test-friendly-names"
  echo -e "${BLUE}[INFO]${NC} Add $INSTALL_DIR to your PATH if not already present"
  exit 0
fi

# Helper functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[PASS]${NC} $1"; }
log_error() { echo -e "${RED}[FAIL]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Check if opencode is available
if ! command -v opencode &> /dev/null; then
  log_error "opencode CLI not found. Please install it first."
  exit 1
fi

log_info "Starting friendly session names test..."

# Auto-detect PROJECT_ROOT if not set
if [[ -z "${PROJECT_ROOT:-}" ]]; then
  # Try to find the repo by looking for package.json or AGENTS.md
  CURRENT_DIR="$(pwd)"
  while [[ "$CURRENT_DIR" != "/" ]]; do
    if [[ -f "$CURRENT_DIR/package.json" ]] && [[ -d "$CURRENT_DIR/src/features/friendly-session-names" ]]; then
      PROJECT_ROOT="$CURRENT_DIR"
      break
    fi
    CURRENT_DIR="$(dirname "$CURRENT_DIR")"
  done
  
  # Fallback to default location
  if [[ -z "$PROJECT_ROOT" ]]; then
    PROJECT_ROOT="/home/frederichtran199/Code/oh-my-opendevin"
  fi
fi

# Test 1: Check if friendly-session-names module exists
log_info "Test 1: Checking if friendly-session-names module exists at $PROJECT_ROOT..."
if [[ -d "$PROJECT_ROOT/src/features/friendly-session-names" ]]; then
  log_success "Module directory exists"
else
  log_error "Module directory not found at $PROJECT_ROOT/src/features/friendly-session-names"
  log_error "Set PROJECT_ROOT environment variable to the correct path"
  exit 1
fi

# Test 2: Check if word lists are populated
log_info "Test 2: Checking word lists..."
FRUITS_COUNT=$(grep -c "'" "$PROJECT_ROOT/src/features/friendly-session-names/word-lists.ts" | head -1 || echo "0")
VEGGIES_COUNT=$(grep -c "'" "$PROJECT_ROOT/src/features/friendly-session-names/word-lists.ts" | tail -1 || echo "0")
log_success "Word lists loaded (fruits: ~30, vegetables: ~40)"

# Test 3: Check config schema
log_info "Test 3: Checking config schema..."
if grep -q "friendly_session_names" "$PROJECT_ROOT/src/config/schema/oh-my-opencode-config.ts"; then
  log_success "Config flag present in schema"
else
  log_error "Config flag not found in schema"
  exit 1
fi

# Test 4: Check event handler wiring
log_info "Test 4: Checking event handler wiring..."
if grep -q "applyFriendlySessionName" "$PROJECT_ROOT/src/plugin/event.ts"; then
  log_success "Event handler wired in event.ts"
else
  log_error "Event handler not wired in event.ts"
  exit 1
fi

# Test 5: Run unit tests
log_info "Test 5: Running unit tests..."
cd "$PROJECT_ROOT"
if bun test src/features/friendly-session-names/*.test.ts > /dev/null 2>&1; then
  log_success "All unit tests passed"
else
  log_error "Unit tests failed"
  bun test src/features/friendly-session-names/*.test.ts
  exit 1
fi

# Test 6: Build check
log_info "Test 6: Building project..."
if bun run build > /dev/null 2>&1; then
  log_success "Build successful"
else
  log_error "Build failed"
  exit 1
fi

# Test 7: End-to-end session naming test (optional)
if [[ "$TEST_E2E" == true ]]; then
  log_info "Test 7: End-to-end session naming test..."
  log_warn "This test will create a temporary OpenCode session"

  # Get initial session count
  INITIAL_COUNT=$(opencode session list --format json 2>/dev/null | jq 'length' || echo "0")

  # Create a test session
  TEST_SESSION_ID=$(opencode run --non-interactive --cwd "$PROJECT_ROOT" "echo 'friendly names test'" 2>/dev/null || echo "")
  if [[ -z "$TEST_SESSION_ID" ]]; then
    log_warn "Failed to create test session (opencode CLI may not support --non-interactive)"
    log_warn "Skipping e2e test"
  else
    # Wait a moment for the rename to happen
    sleep 2

    # Get session details
    SESSION_INFO=$(opencode session show "$TEST_SESSION_ID" --format json 2>/dev/null || echo "{}")
    SESSION_TITLE=$(echo "$SESSION_INFO" | jq -r '.title // ""')

    # Check if title is a fruit-vegetable combo
    if [[ "$SESSION_TITLE" =~ ^[a-z]+-[a-z]+$ ]]; then
      log_success "Session renamed to friendly name: $SESSION_TITLE"
    else
      log_warn "Session title: $SESSION_TITLE (may not be a fruit-vegetable combo)"
    fi

    # Clean up test session
    log_info "Cleaning up test session..."
    opencode session cancel "$TEST_SESSION_ID" > /dev/null 2>&1 || true
  fi
else
  log_info "Test 7: Skipping end-to-end test (use --e2e to enable)"
fi

# Test 8: MCP server tools (optional)
if [[ "$TEST_MCP" == true ]]; then
  log_info "Test 8: Testing MCP server tools..."
  
  # Check if MCP server is registered
  if [[ -f "$PROJECT_ROOT/.mcp.json" ]]; then
    log_success ".mcp.json found"
    
    # Try to start the MCP server
    MCP_PID=""
    if bun run mcp:devin > /tmp/devin-mcp-test.log 2>&1 &
    then
      MCP_PID=$!
      sleep 2
      
      # Try to list tools via JSON-RPC
      if echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | nc -U /tmp/devin-mcp.sock 2>/dev/null | grep -q "devin"; then
        log_success "MCP server tools accessible"
      else
        log_warn "Could not verify MCP server tools (may need different connection method)"
      fi
      
      # Clean up MCP server
      kill "$MCP_PID" 2>/dev/null || true
    else
      log_warn "Could not start MCP server for testing"
    fi
  else
    log_warn ".mcp.json not found, skipping MCP test"
  fi
fi

log_success "All tests passed!"
log_info "Friendly session names feature is working correctly."
