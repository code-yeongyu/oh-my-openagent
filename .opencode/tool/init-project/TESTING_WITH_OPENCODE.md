# Testing Init-Project with OpenCode

This guide explains how to test the `init-project` command with OpenCode's orchestrator agent.

## Understanding How It Works

### Command Execution Flow

1. **User invokes command**: `@orchestrator Run init-project`
2. **Orchestrator reads**: `.opencode/command/init-project.md`
3. **Orchestrator follows flow**: Interactive steps defined in markdown
4. **Orchestrator uses tools**:
   - `bash` tool → Executes TypeScript utilities
   - `read` tool → Reads existing config files
   - `write` tool → Creates new config files
   - `list` tool → Checks directory structure

### Key Point

The command definition (`.opencode/command/init-project.md`) is **instructions for the AI agent**, not executable code. The agent interprets these instructions and uses available tools to execute them.

## Step-by-Step Testing

### Step 1: Prepare Test Environment

```bash
# Create a test project
mkdir /tmp/opencode-test
cd /tmp/opencode-test

# Create minimal project structure
cat > package.json << 'EOF'
{
  "name": "test-app",
  "version": "1.0.0",
  "description": "A test application",
  "dependencies": {
    "react": "^18.2.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "vitest": "^1.0.0"
  }
}
EOF

# Create tsconfig.json
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022"
  }
}
EOF
```

### Step 2: Test Utilities Standalone

Before testing with OpenCode, verify utilities work:

```bash
cd /path/to/project-template/.opencode/tool/init-project

# Install dependencies
npm install

# Test tech detection
npm run detect /tmp/opencode-test

# Should output detected technologies
```

### Step 3: Test with OpenCode

#### Option A: Direct Command Invocation

In OpenCode chat:

```
You: @orchestrator Please initialize this project with OpenCode. Use the init-project command.

Orchestrator should:
1. Read .opencode/command/init-project.md
2. Detect this is an existing project
3. Scan for technology stack
4. Ask about architecture pattern
5. Generate configuration files
```

#### Option B: Step-by-Step Testing

Test each component:

**1. Test Tech Detection:**
```
You: @orchestrator Use the bash tool to run tech detection on this project:
npx ts-node .opencode/tool/init-project/tech-detection.ts $(pwd)
```

**2. Test Config Generation:**
```
You: @orchestrator Generate an opencode.json file for a TypeScript/React project using the config-generator utility
```

**3. Test Full Flow:**
```
You: @orchestrator Follow the init-project command flow to initialize OpenCode for this project
```

### Step 4: Verify Generated Files

After OpenCode execution:

```bash
cd /tmp/opencode-test

# Check files were created
ls -la .opencode/
ls -la AGENTS.md

# Validate JSON
cat .opencode/opencode.json | jq .

# Validate YAML (if yq installed)
cat .opencode/project-context.yaml | yq .

# Check AGENTS.md
cat AGENTS.md
```

## Expected Behavior

### What the Orchestrator Should Do

1. **Read command definition**
   - Uses `read` tool to load `.opencode/command/init-project.md`

2. **Check existing config**
   - Uses `list` tool to check for `.opencode/` directory
   - Uses `read` tool to check for existing files

3. **Detect technology**
   - Uses `bash` tool to run: `npx ts-node .opencode/tool/init-project/tech-detection.ts`
   - Parses output to understand tech stack

4. **Gather information**
   - Asks user questions (interactive)
   - Uses detected values or user input

5. **Generate files**
   - Uses `bash` tool to run: `npx ts-node .opencode/tool/init-project/runner.ts`
   - Or uses `write` tool directly to create files

6. **Create summary**
   - Shows what was created
   - Provides next steps

### Example Orchestrator Output

```
📂 Checking for existing OpenCode configuration...
✅ No existing config found

🔍 Scanning project for technology stack...
📊 Detected:
- TypeScript 5.3
- React 18.2.0
- Vitest (testing)

🏗️ Architecture Pattern Selection:
Based on your web-app project, I recommend: Layered Architecture

Would you like to:
1. Use recommended (Layered)
2. See other options
3. Define custom

> [User selects 1]

⚙️ Generating configuration files...
✅ Created .opencode/opencode.json
✅ Created .opencode/project-context.yaml
✅ Created AGENTS.md
✅ Created src/controllers/AGENTS.md
✅ Created src/services/AGENTS.md
...

🎉 Project Initialized Successfully!
[Shows summary]
```

## Troubleshooting

### Issue: Orchestrator can't find command

**Check**: Command file exists
```bash
ls -la .opencode/command/init-project.md
```

**Solution**: Ensure file has correct frontmatter:
```yaml
---
name: init-project
description: Initialize OpenCode configuration
agent: orchestrator
---
```

### Issue: Bash tool execution fails

**Check**: Node.js and TypeScript available
```bash
node --version  # Should be v18+
npx ts-node --version
```

**Solution**: Ensure `opencode.json` allows bash:
```json
{
  "permission": {
    "bash": {
      "*": "ask",
      "npx ts-node": "allow"
    }
  }
}
```

### Issue: Generated files are invalid

**Check**: Validate JSON/YAML
```bash
cat .opencode/opencode.json | jq .
cat .opencode/project-context.yaml | yq .
```

**Solution**: Check TypeScript utilities for errors:
```bash
cd .opencode/tool/init-project
npm run validate
```

### Issue: Orchestrator doesn't follow flow

**Check**: Command definition is clear
- Read `.opencode/command/init-project.md`
- Ensure instructions are explicit

**Solution**: The command definition should have clear step-by-step instructions that the orchestrator can follow.

## Validation Checklist

After testing with OpenCode:

- [ ] Orchestrator can read command definition
- [ ] Orchestrator detects existing project
- [ ] Orchestrator runs tech detection
- [ ] Orchestrator generates opencode.json
- [ ] Orchestrator generates project-context.yaml
- [ ] Orchestrator creates AGENTS.md files
- [ ] Generated files are valid JSON/YAML
- [ ] Generated files match detected tech stack
- [ ] Summary is shown with next steps

## Next Steps After Validation

1. ✅ Test with different project types (API, CLI, monorepo)
2. ✅ Test edge cases (existing config, missing API key)
3. ✅ Test Linear integration (if API key available)
4. ✅ Test Mintlify setup
5. ✅ Document any issues found
6. ✅ Proceed to Phase 6: Custom Tools

## Quick Reference

**Test command:**
```
@orchestrator Run the init-project command to initialize OpenCode for this project
```

**Manual utility test:**
```bash
cd .opencode/tool/init-project
npm run detect /path/to/project
npm run run /path/to/project
```

**Validation script:**
```bash
cd .opencode/tool/init-project
npm run validate
```

