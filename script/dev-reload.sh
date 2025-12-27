#!/bin/bash
# dev-reload.sh - Clear cache and rebuild plugin for THIS project only
# Usage: ./script/dev-reload.sh [--open]
# Note: Does NOT affect other OpenCode sessions. You must reload manually.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🔄 oh-my-opencode dev reload"
echo "   Project: $PROJECT_ROOT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "1️⃣  Clearing project module cache..."
rm -rf "$PROJECT_ROOT/node_modules/.cache" 2>/dev/null || true

echo "2️⃣  Touching src/index.ts to invalidate import cache..."
touch "$PROJECT_ROOT/src/index.ts"

echo "3️⃣  Rebuilding plugin..."
cd "$PROJECT_ROOT"
bun run build

echo "4️⃣  Clearing plugin log..."
LOG_FILE="/var/folders/nx/2bbdspcd55vbjg7lf6l_tymh0000gn/T/oh-my-opencode.log"
if [ -f "$LOG_FILE" ]; then
    : > "$LOG_FILE"
    echo "   Cleared: $LOG_FILE"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Plugin rebuilt."
echo ""
echo "To reload in your OpenCode session:"
echo "  • TUI: quit and restart opencode"
echo "  • API: curl -X POST http://localhost:PORT/instance/dispose"

if [[ "$1" == "--restart" ]]; then
    echo ""
    echo "5️⃣  Killing OpenCode in this directory..."
    pgrep -f "opencode.*$PROJECT_ROOT" | xargs kill -9 2>/dev/null || true
    sleep 1
    echo "6️⃣  Starting OpenCode..."
    cd "$PROJECT_ROOT"
    opencode
elif [[ "$1" == "--open" ]]; then
    echo ""
    echo "5️⃣  Starting OpenCode..."
    cd "$PROJECT_ROOT"
    opencode
fi
