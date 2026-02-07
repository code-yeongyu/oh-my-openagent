# Local Testing Guide: oh-my-opencode acp-json-error Branch

## Overview

This guide helps you test the `acp-json-error` branch locally to verify:
1. **TUI functionality** - OpenCode CLI works correctly
2. **ACP integration** - Claude Code Plugin loads and functions properly

---

## Prerequisites

- Bun installed (`bun --version`)
- OpenCode installed (`opencode --version`)
- Claude Code (if testing ACP integration)

---

## Setup: Install Branch Locally

### Option 1: Install from GitHub (Recommended)

```bash
# Install directly from the branch
bun install --global github:potb/oh-my-opencode#acp-json-error

# Verify installation
oh-my-opencode --version
```

### Option 2: Build from Source

```bash
# Clone and checkout the branch
git clone https://github.com/potb/oh-my-opencode.git
cd oh-my-opencode
git checkout acp-json-error

# Install dependencies
bun install

# Build the project
bun run build

# Link globally for testing
bun link

# In another directory, link the package
bun link oh-my-opencode
```

---

## Test 1: TUI Functionality (OpenCode CLI)

### 1.1 Basic Agent Operations

Test that agents can be invoked and respond correctly:

```bash
# Navigate to a test project
cd /path/to/test/project

# Initialize oh-my-opencode (if not already done)
oh-my-opencode init

# Test basic agent invocation
opencode "List all TypeScript files in src/"

# Test background agent
opencode "Run a background task to analyze the codebase"

# Test delegation
opencode "Delegate a task to the oracle agent"
```

**Expected**: Agents respond without JSON Parse errors, tasks complete successfully.

### 1.2 Hook Behavior

Test hooks that were modified in this PR:

```bash
# Test Atlas hook (boulder continuation)
opencode "Create a work plan and start executing it"
# Let it run, then interrupt and resume - should continue from where it left off

# Test Ralph loop
opencode "Start a ralph loop for continuous development"
# Should iterate without JSON Parse errors

# Test todo continuation enforcer
opencode "Create a todo list and mark some items incomplete"
# Should inject continuation prompts without errors
```

**Expected**: Hooks fire correctly, no JSON Parse errors in logs.

### 1.3 Background Tasks

Test background task management:

```bash
# Launch a background task
opencode "Launch a background task to search the codebase"

# Check task status
opencode "Show background task status"

# Cancel a task
opencode "Cancel the background task"
```

**Expected**: Background tasks launch, run, and can be cancelled without errors.

### 1.4 Check Logs for Errors

```bash
# Monitor OpenCode logs for JSON Parse errors
tail -f ~/.opencode/logs/opencode.log | grep -i "json parse"

# Should see NO "JSON Parse error: Unexpected EOF" messages
```

---

## Test 2: ACP Integration (Claude Code Plugin)

### 2.1 Install Plugin in Claude Code

**Method 1: Via opencode.json**

Edit your `~/.config/opencode/opencode.json`:

```json
{
  "plugins": [
    {
      "name": "oh-my-opencode",
      "path": "/path/to/oh-my-opencode"  // Path to your local build
    }
  ]
}
```

**Method 2: Via CLI**

```bash
opencode plugin install /path/to/oh-my-opencode
```

### 2.2 Verify Plugin Loads

```bash
# Start Claude Code
opencode

# In Claude Code, check plugin status
/plugins list

# Should see "oh-my-opencode" loaded without errors
```

### 2.3 Test Plugin Tools

In Claude Code, test the tools that use `session.prompt()`:

```bash
# Test delegate_task tool
/delegate "Test task delegation" --category quick

# Test call_omo_agent tool
/agent oracle "What is the current project structure?"

# Test background task tool
/background "Analyze codebase in background"

# Test look_at tool (previously had isJsonParseError band-aid)
/look_at screenshot.png "Describe this image"
```

**Expected**: All tools execute without JSON Parse errors.

### 2.4 Test Hook Integration

Test hooks in the ACP environment:

```bash
# Test Atlas hook (boulder continuation)
# Create a work plan, let it run, then check if continuation works

# Test unstable-agent-babysitter hook
# Use an unstable model (gemini, minimax) and verify reminder fires

# Test session recovery hook
# Simulate a session crash and verify recovery prompt fires
```

**Expected**: Hooks fire correctly in ACP environment, no JSON Parse errors.

### 2.5 Monitor ACP Logs

```bash
# Check Claude Code logs for errors
tail -f ~/.config/opencode/logs/plugin-oh-my-opencode.log | grep -i "json parse"

# Should see NO "JSON Parse error: Unexpected EOF" messages
```

---

## Test 3: Regression Testing

### 3.1 Verify No Breaking Changes

Test existing functionality that should NOT be affected:

```bash
# Test model suggestion retry (wrapper still works)
opencode "Use a non-existent model" --model "fake-model-123"
# Should get model suggestion error (not JSON Parse error)

# Test parseModelSuggestion utility
# (Internal function, but verify via model suggestion errors)

# Test fire-and-forget prompts
# (Background agent spawner, manager - should still catch HTTP errors)
```

**Expected**: Existing error handling still works, no regressions.

### 3.2 Run Test Suite

```bash
cd /path/to/oh-my-opencode
bun test

# Focus on migration-specific tests
bun test src/shared/model-suggestion-retry.test.ts
bun test src/hooks/todo-continuation-enforcer.test.ts
```

**Expected**: All tests pass (migration tests: 57/57).

---

## Test 4: Specific Scenarios

### 4.1 Scenario: Background Agent Notification

```bash
# Start a long-running background task
opencode "Analyze entire codebase and generate report"

# Wait for completion
# Should receive notification via promptAsync (no JSON Parse error)
```

### 4.2 Scenario: Boulder Continuation

```bash
# Create a work plan with multiple tasks
opencode "Create a plan to refactor the authentication module"

# Let Atlas start executing
# Interrupt mid-execution (Ctrl+C)

# Resume
opencode "Continue the work plan"

# Should inject continuation prompt via promptAsync (no JSON Parse error)
```

### 4.3 Scenario: Look At Tool

```bash
# Test the look_at tool (previously had isJsonParseError band-aid)
opencode "Analyze this diagram" --attach diagram.png

# Should work without falling back to JSON Parse error handler
```

---

## Success Criteria

### ✅ TUI Tests Pass If:
- Agents respond without JSON Parse errors
- Hooks fire correctly (Atlas, Ralph, todo-continuation)
- Background tasks launch and complete
- Logs show NO "JSON Parse error: Unexpected EOF"

### ✅ ACP Tests Pass If:
- Plugin loads in Claude Code without errors
- All tools execute correctly (delegate_task, call_omo_agent, background, look_at)
- Hooks integrate properly in ACP environment
- Logs show NO "JSON Parse error: Unexpected EOF"

### ✅ Regression Tests Pass If:
- Existing error handling still works
- Model suggestion errors still provide suggestions
- Fire-and-forget prompts still catch HTTP errors
- Test suite passes (57/57 migration tests)

---

## Reporting Results

After testing, update the PR with your findings:

```markdown
## Testing Results

### TUI Testing
- ✅/❌ Basic agent operations
- ✅/❌ Hook behavior (Atlas, Ralph, todo-continuation)
- ✅/❌ Background tasks
- ✅/❌ No JSON Parse errors in logs

### ACP Testing
- ✅/❌ Plugin loads successfully
- ✅/❌ Tools execute correctly
- ✅/❌ Hooks integrate properly
- ✅/❌ No JSON Parse errors in logs

### Regression Testing
- ✅/❌ No breaking changes
- ✅/❌ Test suite passes

### Issues Found
[List any issues discovered during testing]

### Recommendation
[Ready for merge / Needs fixes / etc.]
```

---

## Troubleshooting

### Issue: "Module not found" after installation

```bash
# Clear bun cache
rm -rf ~/.bun/install/cache

# Reinstall
bun install --global github:potb/oh-my-opencode#acp-json-error
```

### Issue: Plugin not loading in Claude Code

```bash
# Check plugin path in opencode.json
cat ~/.config/opencode/opencode.json

# Verify plugin directory exists
ls -la /path/to/oh-my-opencode

# Restart Claude Code
opencode restart
```

### Issue: Still seeing JSON Parse errors

```bash
# Verify you're using the correct branch
cd /path/to/oh-my-opencode
git branch --show-current
# Should show: acp-json-error

# Check for remaining session.prompt() calls
grep -rn 'session\.prompt(' src/ --include='*.ts' | grep -v 'promptAsync' | grep -v '\.test\.'
# Should return: 0 matches
```

---

## Next Steps After Testing

1. **If tests pass**: Comment on PR with results, mark as ready for review
2. **If issues found**: Document issues, create follow-up tasks
3. **If ready**: Merge to dev branch (per AGENTS.md: ALL PRs → dev)

---

## Quick Reference

| Test Area | Command | Expected Result |
|-----------|---------|-----------------|
| Agent invocation | `opencode "List files"` | No JSON Parse error |
| Background task | `opencode "Background analysis"` | Task completes |
| Hook behavior | `opencode "Create work plan"` | Continuation works |
| Plugin load | `opencode plugin list` | oh-my-opencode loaded |
| Tool execution | `/delegate "Test task"` | Tool executes |
| Logs check | `tail -f ~/.opencode/logs/*.log` | No JSON Parse EOF |

---

**Good luck with testing! 🚀**
