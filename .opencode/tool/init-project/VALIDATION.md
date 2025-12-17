# Init-Project Command Validation Guide

This guide explains how to test and validate the `init-project` command implementation with OpenCode.

## Overview

The `init-project` command consists of:
1. **Command Definition**: `.opencode/command/init-project.md` - Markdown instructions for the orchestrator agent
2. **TypeScript Utilities**: `.opencode/tool/init-project/*.ts` - Programmatic tools for detection and generation
3. **Test Suite**: `.opencode/tool/init-project/__tests__/` - Unit tests for utilities

## Testing Strategy

### Level 1: Unit Tests (TypeScript Utilities)

Test the TypeScript utilities independently:

```bash
# Install dependencies (if needed)
cd .opencode/tool/init-project
npm install --save-dev @types/node typescript ts-node jest @types/jest

# Run unit tests
npm test
# or
npx jest
```

**What to Test:**
- ✅ Technology detection from various config files
- ✅ Architecture suggestion logic
- ✅ Config file generation (JSON/YAML validation)
- ✅ AGENTS.md generation
- ✅ Edge case handling

### Level 2: CLI Execution Test

Test the utilities as standalone CLI tools:

```bash
# Test tech detection
cd /path/to/test-project
npx ts-node .opencode/tool/init-project/tech-detection.ts

# Test full initialization (non-interactive)
npx ts-node .opencode/tool/init-project/runner.ts /path/to/test-project
```

### Level 3: OpenCode Agent Integration Test

Test with OpenCode's orchestrator agent executing the command:

#### Option A: Direct Agent Invocation

1. **Prepare a test project**:
   ```bash
   mkdir /tmp/test-opencode-init
   cd /tmp/test-opencode-init
   
   # Create a simple project structure
   echo '{"name": "test-app", "version": "1.0.0"}' > package.json
   ```

2. **Invoke via OpenCode**:
   ```
   @orchestrator Run the init-project command for this project
   ```

   The orchestrator should:
   - Read `.opencode/command/init-project.md`
   - Execute the interactive flow
   - Use `bash` tool to run TypeScript utilities when needed
   - Generate configuration files

#### Option B: Manual Command Execution

Since OpenCode commands are markdown instructions, you can manually test by:

1. **Reading the command definition**:
   ```bash
   cat .opencode/command/init-project.md
   ```

2. **Following the flow manually**:
   - Execute each step as documented
   - Use the TypeScript utilities via `bash` tool
   - Verify outputs

### Level 4: End-to-End Validation

Create a complete test scenario:

```bash
# Create test project
mkdir -p /tmp/opencode-test/{new-project,existing-project,monorepo}

# Test 1: New TypeScript/React project
cd /tmp/opencode-test/new-project
echo '{"name": "my-react-app", "dependencies": {"react": "^18.0.0"}}' > package.json

# Test 2: Existing Python/FastAPI project  
cd /tmp/opencode-test/existing-project
cat > pyproject.toml << EOF
[tool.poetry]
name = "fastapi-service"
version = "1.0.0"
[tool.poetry.dependencies]
python = "^3.12"
fastapi = "^0.109.0"
EOF

# Test 3: Monorepo
cd /tmp/opencode-test/monorepo
echo 'packages:\n  - "packages/*"' > pnpm-workspace.yaml
mkdir -p packages/{web,api}
```

Then run init-project for each and validate outputs.

## Validation Checklist

### ✅ TypeScript Utilities Work

- [ ] `tech-detection.ts` can detect TypeScript projects
- [ ] `tech-detection.ts` can detect Python projects
- [ ] `tech-detection.ts` can detect monorepos
- [ ] `config-generator.ts` generates valid JSON
- [ ] `config-generator.ts` generates valid YAML
- [ ] `agents-generator.ts` creates AGENTS.md files
- [ ] `edge-cases.ts` handles existing config
- [ ] `linear-setup.ts` validates API keys

### ✅ Generated Files Are Valid

- [ ] `.opencode/opencode.json` is valid JSON
- [ ] `.opencode/project-context.yaml` is valid YAML
- [ ] `.opencode/project-context.yaml` matches schema
- [ ] `AGENTS.md` files are well-formed markdown
- [ ] Layer `AGENTS.md` files reference correct paths

### ✅ OpenCode Integration Works

- [ ] Orchestrator can read command definition
- [ ] Orchestrator can execute bash commands to run utilities
- [ ] Generated configs are recognized by OpenCode
- [ ] Agents can read generated AGENTS.md files
- [ ] Linear MCP integration works (if API key set)

## Quick Test Script

Create a simple validation script:

```bash
#!/bin/bash
# .opencode/tool/init-project/validate.sh

set -e

echo "🧪 Validating Init-Project Command..."

# Test 1: TypeScript utilities compile
echo "✓ Checking TypeScript compilation..."
npx tsc --noEmit .opencode/tool/init-project/*.ts || {
  echo "❌ TypeScript compilation failed"
  exit 1
}

# Test 2: Unit tests pass
echo "✓ Running unit tests..."
npm test || {
  echo "❌ Unit tests failed"
  exit 1
}

# Test 3: CLI execution
echo "✓ Testing CLI execution..."
TEST_DIR=$(mktemp -d)
cd "$TEST_DIR"
echo '{"name": "test", "version": "1.0.0"}' > package.json

npx ts-node /path/to/.opencode/tool/init-project/runner.ts "$TEST_DIR" || {
  echo "❌ CLI execution failed"
  exit 1
}

# Test 4: Validate generated files
echo "✓ Validating generated files..."
test -f "$TEST_DIR/.opencode/opencode.json" || {
  echo "❌ opencode.json not generated"
  exit 1
}

test -f "$TEST_DIR/.opencode/project-context.yaml" || {
  echo "❌ project-context.yaml not generated"
  exit 1
}

test -f "$TEST_DIR/AGENTS.md" || {
  echo "❌ AGENTS.md not generated"
  exit 1
}

# Validate JSON
cat "$TEST_DIR/.opencode/opencode.json" | jq . > /dev/null || {
  echo "❌ opencode.json is invalid JSON"
  exit 1
}

echo "✅ All validation checks passed!"
rm -rf "$TEST_DIR"
```

## Testing with OpenCode Agent

### Method 1: Direct Command Invocation

In OpenCode chat, ask:

```
@orchestrator Please run the init-project command. I want to initialize OpenCode for this project.
```

The orchestrator should:
1. Read `.opencode/command/init-project.md`
2. Follow the interactive flow
3. Use `bash` tool to execute TypeScript utilities
4. Generate all configuration files

### Method 2: Step-by-Step Testing

Test each component individually:

1. **Test tech detection**:
   ```
   @orchestrator Use the bash tool to run: 
   npx ts-node .opencode/tool/init-project/tech-detection.ts
   ```

2. **Test config generation**:
   ```
   @orchestrator Generate opencode.json for a TypeScript/React project using the config-generator tool
   ```

3. **Test full flow**:
   ```
   @orchestrator Initialize OpenCode for this project using the init-project command
   ```

## Common Issues & Solutions

### Issue: TypeScript files not executable

**Solution**: Ensure Node.js and TypeScript are available:
```bash
node --version  # Should be v18+
npx ts-node --version  # Should be installed
```

### Issue: OpenCode can't find tools

**Solution**: Tools are in `.opencode/tool/init-project/`. The orchestrator needs to use full paths:
```bash
npx ts-node .opencode/tool/init-project/runner.ts $(pwd)
```

### Issue: Generated files have errors

**Solution**: Validate JSON/YAML:
```bash
# JSON
cat .opencode/opencode.json | jq .

# YAML  
cat .opencode/project-context.yaml | yq .
```

### Issue: Linear integration fails

**Solution**: Check API key:
```bash
echo $LINEAR_API_KEY  # Should output your key
```

## Manual Validation Steps

1. **Create a test project**:
   ```bash
   mkdir /tmp/test-init
   cd /tmp/test-init
   echo '{"name": "test", "version": "1.0.0"}' > package.json
   ```

2. **Run init-project manually**:
   ```bash
   cd /path/to/project-template
   npx ts-node .opencode/tool/init-project/runner.ts /tmp/test-init
   ```

3. **Verify outputs**:
   ```bash
   cd /tmp/test-init
   ls -la .opencode/
   cat .opencode/opencode.json
   cat .opencode/project-context.yaml
   cat AGENTS.md
   ```

4. **Test with OpenCode**:
   - Copy test project to a real location
   - Run OpenCode
   - Ask: `@orchestrator initialize this project with OpenCode`

## Next Steps

After validation:

1. ✅ All utilities work standalone
2. ✅ Generated files are valid
3. ✅ OpenCode orchestrator can execute command
4. ✅ Real projects can be initialized
5. ✅ Edge cases are handled

Then proceed to Phase 6: Custom Tools!

