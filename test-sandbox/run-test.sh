#!/usr/bin/env bash

# Test Sandbox - Isolated from your actual config

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SANDBOX_DIR="$REPO_ROOT/test-sandbox/omo-test-config"

export OPENCODE_CONFIG_DIR="$SANDBOX_DIR"
export OH_MY_OPENCODE_CONFIG_DIR="$SANDBOX_DIR/oh-my-opencode"

echo "🧪 Running in sandbox:"
echo "   Config dir: $SANDBOX_DIR"
echo ""

# Run the install
bun run "$REPO_ROOT/src/cli/index.ts" install "$@"

echo ""
echo "📋 Sandbox config created at:"
echo "   $SANDBOX_DIR"
echo ""
echo "🧹 Clean up with: rm -rf test-sandbox"
