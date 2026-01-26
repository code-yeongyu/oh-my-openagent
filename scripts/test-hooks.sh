#!/bin/bash

# Test Helper Script for oh-my-opencode Hooks
# This script guides manual QA testing of the 4 new hooks

set -e

# Colors for output
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}oh-my-opencode Hook QA Testing Guide${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Verify hooks are registered (check each hook individually)
echo -e "${YELLOW}[1/5] Verifying hooks are registered...${NC}"
HOOKS=("notification-on-idle" "fixed-comment-rule" "tmux-long-running" "git-push-reviewer")
MISSING_HOOKS=()
for hook in "${HOOKS[@]}"; do
  if grep -q "$hook" dist/index.js 2>/dev/null; then
    echo -e "${GREEN}  ✓ $hook${NC}"
  else
    echo -e "${YELLOW}  ✗ $hook (missing)${NC}"
    MISSING_HOOKS+=("$hook")
  fi
done

if [ ${#MISSING_HOOKS[@]} -eq 0 ]; then
  echo -e "${GREEN}✓ All 4 hooks registered in dist/index.js${NC}"
else
  echo -e "${YELLOW}⚠ Warning: ${#MISSING_HOOKS[@]} hook(s) not found: ${MISSING_HOOKS[*]}${NC}"
fi
echo ""

# Display test instructions
echo -e "${YELLOW}[2/5] Hook Testing Instructions${NC}"
echo ""

echo -e "${GREEN}Hook 1: notification-on-idle${NC}"
echo "  Purpose: Sends macOS notifications when AI asks a question or completes"
echo "  Test Steps:"
echo "    1. Start a NEW opencode session (not this one)"
echo "    2. Ask the AI a question that makes it ask back (e.g., 'What should I build?')"
echo "    3. Verify: macOS notification appears with the AI's question"
echo "    4. Request a task completion and verify notification appears"
echo ""

echo -e "${GREEN}Hook 2: fixed-comment-rule${NC}"
echo "  Purpose: Injects rule to add '// Fixed: [date]...' comments to bug fixes"
echo "  Test Steps:"
echo "    1. In a NEW opencode session, request a bug fix"
echo "    2. Verify: AI adds '// Fixed: [date] [description]' comment to the fix"
echo "    3. Check that the comment appears in the generated code"
echo ""

echo -e "${GREEN}Hook 3: tmux-long-running${NC}"
echo "  Purpose: Injects rule to use interactive_bash for long-running commands"
echo "  Test Steps:"
echo "    1. In a NEW opencode session, request 'npm install' or similar long command"
echo "    2. Verify: AI uses 'interactive_bash' instead of regular bash"
echo "    3. Check that the command runs in an interactive tmux session"
echo ""

echo -e "${GREEN}Hook 4: git-push-reviewer${NC}"
echo "  Purpose: Blocks git push until user reviews changes in zed and confirms"
echo "  Test Steps:"
echo "    1. In a NEW opencode session, request 'git push'"
echo "    2. Verify: zed opens with the changes to review"
echo "    3. Verify: Terminal prompts 'Proceed with push? (y/n)'"
echo "    4. Test both 'y' (proceed) and 'n' (cancel) responses"
echo ""

echo -e "${YELLOW}[3/5] Pre-QA Checklist${NC}"
echo "  ☐ Build passes: bun run build"
echo "  ☐ All hooks are registered in dist/index.js"
echo "  ☐ You have a NEW opencode session ready (not this one)"
echo ""

echo -e "${YELLOW}[4/5] Running Tests${NC}"
echo "  1. Open a NEW opencode session"
echo "  2. Test each hook according to instructions above"
echo "  3. Verify all 4 hooks work as expected"
echo "  4. Return to this terminal when QA is complete"
echo ""

echo -e "${YELLOW}[5/5] After QA Passes${NC}"
echo "  Run this command to push to origin/dev:"
echo ""
echo -e "${GREEN}  cd ~/repos/oh-my-opencode && git push origin dev${NC}"
echo ""

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Ready to test? Start a NEW opencode session!${NC}"
echo -e "${BLUE}========================================${NC}"
