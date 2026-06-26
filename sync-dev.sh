#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== 1. Fetching latest remote updates from fork ===${NC}"
git fetch fork

# Get the current branch
CURRENT_BRANCH=$(git symbolic-ref --short HEAD)
echo -e "${GREEN}Current working branch is: $CURRENT_BRANCH${NC}"

# If currently on dev, just pull dev
if [ "$CURRENT_BRANCH" = "dev" ]; then
  echo -e "${BLUE}=== Updating local dev branch from fork/dev ===${NC}"
  git pull fork dev
else
  echo -e "${BLUE}=== 2. Updating local dev branch from fork/dev ===${NC}"
  git checkout dev
  git pull fork dev

  echo -e "${BLUE}=== 3. Merging dev into $CURRENT_BRANCH ===${NC}"
  git checkout "$CURRENT_BRANCH"
  
  # Perform merge
  if git merge dev --no-edit; then
    echo -e "${GREEN}Merge successful.${NC}"
  else
    echo -e "${RED}Merge conflict detected. Please resolve conflicts manually.${NC}"
    exit 1
  fi
fi

echo -e "${BLUE}=== 4. Rebuilding project to verify compatibility ===${NC}"
if bun run build; then
  echo -e "${GREEN}Build succeeded.${NC}"
else
  echo -e "${RED}Build failed after merge. Please check typecheck/build errors.${NC}"
  exit 1
fi

echo -e "${GREEN}=== Sync completed successfully! ===${NC}"
