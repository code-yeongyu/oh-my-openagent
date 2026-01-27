#!/bin/bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}--- Oh-my-OpenCode Update Script ---${NC}\n"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Working directory: $SCRIPT_DIR"
echo ""

echo -e "${YELLOW}[1/4]${NC} Pulling latest code from GitHub..."
git pull origin dev
echo -e "${GREEN}✓${NC} Repository updated\n"

echo -e "${YELLOW}[2/4]${NC} Installing dependencies with Bun..."
bun install
echo -e "${GREEN}✓${NC} Dependencies installed\n"

echo -e "${YELLOW}[3/4]${NC} Building project with Bun..."
bun run build
echo -e "${GREEN}✓${NC} Build completed\n"

echo -e "${YELLOW}[4/4]${NC} Verifying build output..."
if [ -f "dist/index.js" ] && [ -f "dist/index.d.ts" ]; then
    echo -e "${GREEN}✓${NC} Build verification successful"
    echo "  - dist/index.js exists"
    echo "  - dist/index.d.ts exists"
else
    echo -e "${RED}✗${NC} Build verification failed - missing build output"
    exit 1
fi

echo ""
echo -e "${GREEN}--- Update Complete ---${NC}"
echo -e "Oh-my-OpenCode is now up to date with latest source code.${NC}"
echo ""
echo "Note: If you're using the local build in opencode.json,"
echo "      restart OpenCode to load the changes."
