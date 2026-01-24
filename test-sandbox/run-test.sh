#!/usr/bin/env bash

# Test Sandbox - Isolated from your actual config

SANDBOX_DIR="$(pwd)/test-sandbox/omo-test-config"
export OPENCODE_CONFIG_DIR="$SANDBOX_DIR"
export OH_MY_OPENCODE_CONFIG_DIR="$SANDBOX_DIR/oh-my-opencode"

echo "🧪 Running in sandbox:"
echo "   Config dir: $SANDBOX_DIR"
echo ""

# Run the install
bun run src/cli/index.ts install "$@"

echo ""
echo "📋 Sandbox config created at:"
echo "   $SANDBOX_DIR"
echo ""
echo "🧹 Clean up with: rm -rf test-sandbox"
