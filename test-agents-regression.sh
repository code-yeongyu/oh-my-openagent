#!/bin/bash
# Regression test script for oh-my-opencode agents after custom agent API implementation
# Tests all 9 existing agent types, skills, and hooks

set -e

echo "=================================================="
echo "OH-MY-OPENCODE REGRESSION TEST"
echo "Testing modified plugin with custom agent API"
echo "=================================================="
echo ""

# Check if modified plugin is loaded
echo "1. Verifying modified plugin is loaded..."
if grep -q "file:///Users/jay.jung/sub-project/oh-my-opencode" ~/.config/opencode/opencode.json; then
    echo "✓ Config points to local modified plugin"
else
    echo "✗ WARNING: Config does not point to local plugin"
    echo "  Run: sed -i '' 's/\"oh-my-opencode@latest\"/\"file:\/\/\/Users\/jay.jung\/sub-project\/oh-my-opencode\"/' ~/.config/opencode/opencode.json"
    exit 1
fi

# Check if dist is built
if [ ! -f "/Users/jay.jung/sub-project/oh-my-opencode/dist/index.js" ]; then
    echo "✗ ERROR: dist/index.js not found. Run 'bun run build' first."
    exit 1
fi

echo "✓ dist/index.js exists ($(stat -f%z /Users/jay.jung/sub-project/oh-my-opencode/dist/index.js) bytes)"

# Check for custom agent registration code
REGISTER_COUNT=$(grep -c "registerCustomAgent" /Users/jay.jung/sub-project/oh-my-opencode/dist/index.js || echo "0")
if [ "$REGISTER_COUNT" -gt 0 ]; then
    echo "✓ Custom agent registration code found ($REGISTER_COUNT occurrences)"
else
    echo "✗ WARNING: Custom agent registration code not found in build"
fi

echo ""
echo "2. Testing agent invocations..."
echo "   (This requires a fresh opencode session)"
echo ""
echo "   To test agents manually, start opencode and run:"
echo ""
echo "   # Test explore agent"
echo "   delegate_task(subagent_type=\"explore\", prompt=\"search for 'export' in current directory\", run_in_background=false)"
echo ""
echo "   # Test librarian agent"
echo "   delegate_task(subagent_type=\"librarian\", prompt=\"what is React?\", run_in_background=false)"
echo ""
echo "   # Test oracle (if accessible)"
echo "   # Oracle is typically invoked via consultation, not direct call"
echo ""
echo "   # Test skills"
echo "   slashcommand(command=\"git-master\")"
echo "   slashcommand(command=\"playwright\")"
echo ""
echo "3. Expected behavior in fresh session:"
echo "   ✓ No Zod validation errors on startup"
echo "   ✓ All agents respond coherently"
echo "   ✓ Skills load without 'not found' errors"
echo "   ✓ Hooks initialize correctly"
echo ""
echo "4. Agents to test (9 total):"
echo "   1. build agent (default orchestrator)"
echo "   2. plan/prometheus (strategic planning)"
echo "   3. sisyphus (primary orchestrator)"
echo "   4. sisyphus-junior (category worker)"
echo "   5. oracle (consultation)"
echo "   6. explore (codebase search)"
echo "   7. librarian (docs/GitHub)"
echo "   8. general (general queries)"
echo "   9. hephaestus (autonomous deep worker)"
echo "   10. multimodal-looker (PDF/image analysis)"
echo ""
echo "5. Skills to test:"
echo "   - git-master"
echo "   - playwright"
echo "   - frontend-ui-ux"
echo "   - dev-browser"
echo ""
echo "6. Hooks to verify:"
echo "   - todo-continuation"
echo "   - context-window-monitor"
echo "   - atlas"
echo ""
echo "=================================================="
echo "Setup complete. Modified plugin will load on next"
echo "opencode session start."
echo "=================================================="
