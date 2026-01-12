# Agent Output Validator Hook - Implementation Patch

## Overview
This patch implements the Agent Output Validator Hook for Oracle and Commander agents, preventing them from writing implementation code and enforcing structured output formats.

## Files Modified (8 files in patch)

### Modified Files
1. **src/agents/index.ts** - Commander agent registration
2. **src/agents/oracle.ts** - Oracle prompt restrictions added
3. **src/config/schema.ts** - Hook name added to schema
4. **src/features/builtin-commands/commands.ts** - Commander slash command added
5. **src/features/builtin-commands/types.ts** - Commander command type added
6. **src/hooks/index.ts** - Hook export added
7. **src/index.ts** - Hook instantiation and execution chain registration
8. **src/shared/index.ts** - Validator exports added

### New Files (4 files - NOT in patch)
1. **src/agents/commander.ts** - Commander agent definition
2. **src/shared/commander-validator.ts** - Commander output validator
3. **src/shared/reviewer-validator.ts** - Oracle output validator
4. **src/hooks/agent-output-validator/index.ts** - Hook implementation

## Key Changes

### 1. Schema Update (src/config/schema.ts)
```diff
+  "agent-output-validator",
```
Added `"agent-output-validator"` to `HookNameSchema` enum.

### 2. Agent Registration (src/agents/index.ts)
```diff
+import { commanderAgent } from "./commander"
+
 export const builtinAgents: Record<string, AgentConfig> = {
   Sisyphus: sisyphusAgent,
   oracle: oracleAgent,
+  commander: commanderAgent,
   librarian: librarianAgent,
```

### 3. Oracle Prompt Restrictions (src/agents/oracle.ts)
Added comprehensive responsibility restrictions to Oracle agent prompt:
- Forbidden: Direct code implementation, file editing, bash commands
- Required: Structured output format (VERDICT + CRITERIA CHECK table)
- Role: Review and analysis ONLY, not implementation

### 4. Commander Slash Command (src/features/builtin-commands/)
- **types.ts**: Added `"commander"` to `BuiltinCommandName` type
- **commands.ts**: Registered `/commander` builtin command
- **templates/commander.ts**: Commander prompt template

Usage:
```
/commander "Design a REST API architecture"
```

### 5. Hook Export (src/hooks/index.ts)
```diff
+export { createAgentOutputValidatorHook } from "./agent-output-validator";
```

### 6. Hook Registration (src/index.ts)
```diff
+import { createAgentOutputValidatorHook } from "./hooks";
+
+const agentOutputValidator = isHookEnabled("agent-output-validator")
+  ? createAgentOutputValidatorHook(ctx)
+  : null;
+
+// In tool.execute.after:
+      await agentOutputValidator?.["tool.execute.after"](input, output);
```

### 7. Validator Exports (src/shared/index.ts)
```diff
+export * from "./commander-validator"
+export * from "./reviewer-validator"
```

## How to Apply This Patch

### Method 1: Apply Patch (Recommended)
```bash
cd /path/to/oh-my-opencode
git apply patches/agent-output-validator-implementation.patch
```

### Method 2: Apply Individual Changes
```bash
# Step 1: Add new files
git add src/agents/commander.ts
git add src/shared/commander-validator.ts
git add src/shared/reviewer-validator.ts
git add src/hooks/agent-output-validator/index.ts

# Step 2: Apply patch
git apply patches/agent-output-validator-implementation.patch
```

### Method 3: Manual (If patch fails)
Apply each change manually:
1. Copy 4 new files to src/ directories
2. Apply 8 modified files from the patch above
3. Run build: `bun run build`

## Verification Steps

After applying the patch:

1. **Build Verification**
```bash
bun run build
```
Expected: `Bundled 571+ modules, 0 errors`

2. **Schema Verification**
```bash
cat assets/oh-my-opencode.schema.json | grep agent-output-validator
```
Expected: `"agent-output-validator"` in HookName values

3. **Runtime Verification**
```bash
# Restart OpenCode
opencode

# Check logs
tail -f /tmp/oh-my-opencode.log | grep agent-output-validator
```

Expected logs when Oracle/Commander are called:
```
[agent-output-validator] Hook called! {"tool":"task","sessionID":"ses_XXX"}
[agent-output-validator] Detected agent type: oracle/commander {"outputLength":N}
[agent-output-validator] Validating Oracle/Commander output: PASS/FAIL
```

## New Trigger Methods

### Method 1: Slash Command (NEW)
```bash
/commander "Architecture planning request"
```

### Method 2: Task Tool (Explicit)
```
task subagent_type="commander" prompt="..."
```

### Method 3: Sisyphus Indirect (Future)
Using architecture/strategy keywords that trigger Commander.

## Build Output
```
Bundled 571 modules in 56ms
  index.js        1.66 MB   (entry point)
  google-auth.js  63.85 KB  (entry point)

Bundled 159 modules in 28ms
  index.js  0.84 MB  (entry point)

Generating JSON Schema...
✓ JSON Schema generated: assets/oh-my-opencode.schema.json
```

## Validation Evidence

### Historical Logs (Already Triggered)
```
[agent-output-validator] Validating Oracle output: FAIL
[agent-output-validator] Validation failed. Error appended to output.
[agent-output-validator] Validating Oracle output: FAIL
[agent-output-validator] Validation failed. Error appended to output.
[agent-output-validator] Validating Commander output: PASS
[agent-output-validator] Validating Commander output: FAIL
[agent-output-validator] Validation failed. Error appended to output.
[agent-output-validator] Validating Oracle output: FAIL
```

### Hook Detection Logic

**Oracle Detection:**
- Marker: `CRITERIA CHECK` in output
- Trigger: tool.execute.after with `tool: task`

**Commander Detection:**
- Marker: `FILES/FUNCTIONS TO CHANGE` or `TASKS FOR IMPLEMENTER` in output
- Trigger: tool.execute.after with `tool: task`

**Implementation Detection:**
- Keywords: `edit(`, `write(`, `bash(`, `sed `, `awk `
- Keywords: `here's code`, `implementation:`, `let me implement`
- Code blocks: >50 chars, not VERDICT/CRITERIA tables

## Rollback Plan

If issues occur:

```bash
# Method 1: Revert patch
git apply --reverse patches/agent-output-validator-implementation.patch

# Method 2: Revert changes
git reset --hard HEAD~1

# Method 3: Revert only this feature
git revert <commit-hash>
```

## Notes

- **Hook execution order**: Runs last in tool.execute.after chain (after all other hooks)
- **Non-blocking**: Hook only validates and appends errors, doesn't block execution
- **Logging**: Enhanced logging includes tool name, session ID, and agent type for debugging
- **Slash command**: `/commander` provides deterministic trigger for testing
- **Schema**: Automatically updated with new hook name

## Summary

✅ **8 modified files** covered in patch
✅ **4 new files** exist in repository
✅ **226 lines** of comprehensive diff
✅ **Build verified** (571 modules, 0 errors)
✅ **Hook triggered** in previous runs (evidence in logs)

**Status: READY FOR DEPLOYMENT**
