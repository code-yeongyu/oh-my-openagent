#!/bin/bash
set -e

# Idempotent setup script for oh-my-opencode mission

# Check bun is available
if ! command -v bun &> /dev/null; then
    echo "Error: bun is not installed"
    exit 1
fi

# Check gh is available
if ! command -v gh &> /dev/null; then
    echo "Warning: gh (GitHub CLI) is not installed - needed for fork/PR operations"
fi

# Install dependencies if node_modules missing
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    bun install
fi

echo "Environment ready"
