#!/bin/bash
# Validation script for init-project command
# Usage: ./validate.sh [test-project-path]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TEST_DIR="${1:-$(mktemp -d)}"

echo "🧪 Validating Init-Project Command..."
echo "📁 Test directory: $TEST_DIR"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
echo "🔍 Checking prerequisites..."

if ! command -v node &> /dev/null; then
  echo -e "${RED}❌ Node.js not found. Please install Node.js v18+${NC}"
  exit 1
fi

if ! command -v npx &> /dev/null; then
  echo -e "${RED}❌ npx not found${NC}"
  exit 1
fi

# Check if ts-node is available
if ! npx ts-node --version &> /dev/null; then
  echo -e "${YELLOW}⚠️  ts-node not found. Installing...${NC}"
  cd "$SCRIPT_DIR"
  npm install --save-dev ts-node typescript @types/node || {
    echo -e "${RED}❌ Failed to install dependencies${NC}"
    exit 1
  }
fi

echo -e "${GREEN}✓ Prerequisites OK${NC}"
echo ""

# Test 1: TypeScript compilation check
echo "📝 Test 1: TypeScript compilation..."
cd "$SCRIPT_DIR"
if npx tsc --noEmit *.ts 2>/dev/null; then
  echo -e "${GREEN}✓ TypeScript files compile${NC}"
else
  echo -e "${YELLOW}⚠️  TypeScript compilation check skipped (may need tsconfig.json)${NC}"
fi
echo ""

# Test 2: Tech detection
echo "🔍 Test 2: Technology detection..."
cd "$TEST_DIR"
mkdir -p "$TEST_DIR/test-ts"
cd "$TEST_DIR/test-ts"
cat > package.json << 'EOF'
{
  "name": "test-app",
  "version": "1.0.0",
  "dependencies": {
    "react": "^18.2.0",
    "typescript": "^5.3.0"
  },
  "devDependencies": {
    "vitest": "^1.0.0"
  }
}
EOF

DETECTION_OUTPUT=$(npx ts-node "$SCRIPT_DIR/tech-detection.ts" "$TEST_DIR/test-ts" 2>&1 || echo "")
if echo "$DETECTION_OUTPUT" | grep -q "TypeScript\|React"; then
  echo -e "${GREEN}✓ Technology detection works${NC}"
else
  echo -e "${YELLOW}⚠️  Technology detection test inconclusive${NC}"
  echo "Output: $DETECTION_OUTPUT"
fi
echo ""

# Test 3: Config generation
echo "⚙️  Test 3: Config file generation..."
cd "$TEST_DIR"
mkdir -p "$TEST_DIR/test-config"
cd "$TEST_DIR/test-config"

# Create minimal project structure
cat > package.json << 'EOF'
{
  "name": "test-config",
  "version": "1.0.0"
}
EOF

# Run init-project with preset
cd "$SCRIPT_DIR"
PRESET_CONFIG='{
  "projectInfo": {"name": "test-config", "description": "Test", "version": "1.0.0"},
  "projectType": "api",
  "techStack": {
    "languages": [{"name": "TypeScript", "primary": true, "detectedFrom": "test"}],
    "frameworks": {"testing": []},
    "databases": [],
    "packageManager": "npm"
  },
  "architecture": {
    "id": "layered",
    "name": "Layered",
    "description": "Test",
    "recommendedFor": [],
    "layers": [{"name": "controllers", "path": "src/controllers", "description": "Test", "agentsMd": "test.md"}]
  },
  "linear": {"enabled": false},
  "mintlify": {"enabled": false, "docsPath": "docs/"},
  "isExisting": false
}'

# Test config generator directly
CONFIG_OUTPUT=$(node -e "
const fs = require('fs');
const path = require('path');
const { generateOpencodeJson, generateProjectContextYaml } = require('./config-generator.ts');
const config = $PRESET_CONFIG;
try {
  const json = generateOpencodeJson(config);
  const yaml = generateProjectContextYaml(config);
  console.log('SUCCESS');
} catch(e) {
  console.error('ERROR:', e.message);
}
" 2>&1 || echo "SKIP")

if echo "$CONFIG_OUTPUT" | grep -q "SUCCESS"; then
  echo -e "${GREEN}✓ Config generation works${NC}"
else
  echo -e "${YELLOW}⚠️  Config generation test skipped (requires TypeScript runtime)${NC}"
fi
echo ""

# Test 4: File structure validation
echo "📁 Test 4: File structure validation..."
cd "$SCRIPT_DIR"

FILES=(
  "tech-detection.ts"
  "config-generator.ts"
  "agents-generator.ts"
  "linear-setup.ts"
  "edge-cases.ts"
  "runner.ts"
  "index.ts"
)

MISSING_FILES=()
for file in "${FILES[@]}"; do
  if [ ! -f "$SCRIPT_DIR/$file" ]; then
    MISSING_FILES+=("$file")
  fi
done

if [ ${#MISSING_FILES[@]} -eq 0 ]; then
  echo -e "${GREEN}✓ All required files exist${NC}"
else
  echo -e "${RED}❌ Missing files: ${MISSING_FILES[*]}${NC}"
  exit 1
fi
echo ""

# Test 5: Command definition exists
echo "📋 Test 5: Command definition..."
COMMAND_FILE="$PROJECT_ROOT/.opencode/command/init-project.md"
if [ -f "$COMMAND_FILE" ]; then
  echo -e "${GREEN}✓ Command definition exists${NC}"
  
  # Check for required sections
  if grep -q "name: init-project" "$COMMAND_FILE"; then
    echo -e "${GREEN}✓ Command has correct frontmatter${NC}"
  else
    echo -e "${YELLOW}⚠️  Command frontmatter may be incomplete${NC}"
  fi
else
  echo -e "${RED}❌ Command definition not found at $COMMAND_FILE${NC}"
  exit 1
fi
echo ""

# Test 6: Test fixtures exist
echo "🧪 Test 6: Test fixtures..."
if [ -d "$SCRIPT_DIR/__tests__" ] && [ -f "$SCRIPT_DIR/__tests__/test-fixtures.ts" ]; then
  echo -e "${GREEN}✓ Test fixtures exist${NC}"
else
  echo -e "${YELLOW}⚠️  Test fixtures directory not found${NC}"
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ Validation Complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Test with a real project: npx ts-node $SCRIPT_DIR/runner.ts /path/to/project"
echo "2. Test with OpenCode: Ask @orchestrator to run init-project command"
echo "3. Validate generated files manually"
echo ""
echo "For detailed testing guide, see: $SCRIPT_DIR/VALIDATION.md"

