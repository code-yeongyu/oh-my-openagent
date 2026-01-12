# Model Responsibility Correction & Validation Status

**Date**: January 11, 2026
**Status**: PARTIALLY COMPLETE - Validator Integration Required

---

## 1. Model Responsibility Configuration (Corrected)

### Updated Configuration File
**Location**: `D:\OpenCode\config\oh-my-opencode.json`

### Agent→Model Mapping (VERIFIED)

| Agent | Model | Responsibility | Status |
|--------|-------|----------------|--------|
| Sisyphus | opencode/glm-4.7 | Main coordinator | ✅ Correct |
| **Build** | **opencode/glm-4.7** | **Implementation only** | ✅ **FIXED** |
| oracle | openai/gpt-5.2-codex | Review & PASS/FAIL only | ✅ Correct |
| commander | codesome/claude-opus-4-5-20251101 | Decisions & specs only | ✅ Correct |
| plan | openai/gpt-5.2 | Planning | ✅ Correct |
| librarian | opencode/glm-4.7 | Documentation research | ✅ Correct |
| explore | google/gemini-3-flash | Code search | ✅ Correct |
| frontend-ui-ux-engineer | google/gemini-3-pro-high | Frontend implementation | ✅ Correct |
| document-writer | google/gemini-3-flash | Documentation | ✅ Correct |
| multimodal-looker | google/gemini-3-flash | Media analysis | ✅ Correct |

### Responsibility Rules (ENFORCED BY CONFIG)

✅ **Implementation Agents** (ONLY GLM-4.7):
- `build` → `opencode/glm-4.7`
- Frontend implementation → `google/gemini-3-pro-high`
- Librarian research → `opencode/glm-4.7`

✅ **Review/Decision Agents** (NO IMPLEMENTATION):
- `oracle` → `openai/gpt-5.2-codex` (Review & PASS/FAIL only)
- `commander` → `codesome/claude-opus-4-5-20251101` (Decisions & specs only)

---

## 2. Validator Status - CRITICAL ISSUE

### Current Validator State

| Validator | File Location | Exported | Integrated | Can Intercept |
|-----------|---------------|-----------|------------|---------------|
| Commander Validator | `src/shared/commander-validator.ts` | ❌ No | ❌ No | ❌ No |
| Reviewer Validator | `src/shared/reviewer-validator.ts` | ❌ No | ❌ No | ❌ No |

### Problem Statement

**Validators are NOT integrated into the system.**

1. **Not Exported**: Neither validator is exported from `src/shared/index.ts`
2. **Not Called**: Neither validator is called anywhere in the codebase
3. **No Hook**: No hook exists to validate agent output before processing

### Verification

```bash
# Check exports from shared/index.ts
$ cat src/shared/index.ts
# Output: NO export statements for commander-validator or reviewer-validator

# Search for validator usage in codebase
$ grep -r "commander-validator\|validateCommander" src/ --include="*.ts"
# Output: NO RESULTS (except the validator file itself)

$ grep -r "reviewer-validator\|validateOracle" src/ --include="*.ts"
# Output: NO RESULTS (except the validator file itself)
```

---

## 3. Interception Mechanisms - NOT WORKING

### What Needs to Happen

To ensure Claude (Commander) and Codex (Oracle) do NOT implement code, we need:

#### Option A: Agent Prompt Restrictions (NOT IMPLEMENTED)
- Modify agent prompts to explicitly forbid implementation
- Add prompts to `src/agents/oracle.ts` and `src/agents/commander.ts`
- Status: ❌ Not done

#### Option B: Hook-Based Validation (NOT IMPLEMENTED)
- Create a new hook: `src/hooks/agent-output-validator/`
- Hook event: `PostToolUse` or `UserPromptSubmit`
- Validate agent output contains no implementation code
- Status: ❌ Not done

#### Option C: Permission Restrictions (PARTIALLY WORKING)
- Codex may have read-only permissions via `createAgentToolRestrictions`
- Status: ⚠️ Partial, needs verification

### Current Hook System

oh-my-opencode supports these hook events:
- `PreToolUse` - Before tool execution
- `PostToolUse` - After tool execution (where we could validate)
- `UserPromptSubmit` - When user submits prompt
- `Stop` - When session stops
- `PreCompact` - Before session compaction

**None of these currently validate agent output.**

---

## 4. Required Fixes

### Priority 1: Export Validators

**File**: `src/shared/index.ts`

Add these exports:
```typescript
export * from "./commander-validator"
export * from "./reviewer-validator"
```

### Priority 2: Create Output Validation Hook

**New File**: `src/hooks/agent-output-validator/index.ts`

Implementation needed:
- Detect which agent is responding
- Check if Oracle or Commander
- Validate output format (VERDICT, CRITERIA CHECK)
- Reject implementation code (edit tools, write tools)
- Force re-generation if format invalid

### Priority 3: Add Prompts to Agents

**File**: `src/agents/oracle.ts`

Add to prompt:
```
You are PROHIBITED from:
- Using file edit tools (edit, write, sed, etc.)
- Implementing code directly
- Making system changes

You MUST:
- Provide structured reviews only
- Output VERDICT and CRITERIA CHECK
- Report issues without fixing them
```

**File**: Need to create `src/agents/commander.ts`

Add similar restrictions.

### Priority 4: Verify Codex Permissions

**File**: Check if `createAgentToolRestrictions` applies to Oracle

Verify that Codex (Oracle) has read-only tool access.

---

## 5. Current Vulnerabilities

### Without Validators, These Can Happen:

1. **Codex (Oracle) could implement code**:
   - Prompt doesn't explicitly forbid implementation
   - No hook validates output
   - No permission restrictions verified

2. **Claude (Commander) could implement code**:
   - Commander agent file doesn't exist in repo
   - If it's invoked via `/commander` slash command, no validation
   - No hook validates output

3. **Review format violations**:
   - Oracle could output unstructured reviews
   - Commander could output unstructured specs
   - No automated validation catches this

---

## 6. Action Plan

### Immediate Actions Required

1. ✅ **DONE**: Update build agent to GLM-4.7
2. ❌ **TODO**: Export validators from `src/shared/index.ts`
3. ❌ **TODO**: Create agent output validation hook
4. ❌ **TODO**: Add implementation prohibition prompts to agents
5. ❌ **TODO**: Verify Codex permission restrictions

### Recommended Implementation Path

**Phase 1**: Prompt-Level Restrictions (Fastest)
- Add "DO NOT IMPLEMENT" prompts to Oracle
- Create Commander agent with same restrictions
- Add prompts to build agent to enforce GLM-4.7

**Phase 2**: Hook-Based Validation (Most Secure)
- Create `agent-output-validator` hook
- Intercept `PostToolUse` events
- Validate Oracle/Commander output format
- Block implementation tools from non-GLM agents

**Phase 3**: Permission-Based Control (Most Robust)
- Verify Codex has read-only tool permissions
- Restrict Claude to analysis-only tools
- Audit tool usage by agent

---

## 7. Testing Plan

### Test 1: Verify Config
```bash
$ node -e "const config = JSON.parse(fs.readFileSync('D:/OpenCode/config/oh-my-opencode.json', 'utf8')); console.log('Build:', config.agents.build.model);"
# Expected: opencode/glm-4.7
```

### Test 2: Verify Exports (After fixing)
```bash
$ grep "commander-validator\|reviewer-validator" src/shared/index.ts
# Expected: Should find export statements
```

### Test 3: Verify Hook (After creating)
```bash
$ ls src/hooks/agent-output-validator/
# Expected: Should exist with index.ts
```

### Test 4: Verify Oracle Restrictions (After fixing)
- Trigger Oracle review
- Check for file edit attempts in logs
- Verify VERDICT format compliance

---

## Summary

**Config**: ✅ Fixed (Build → GLM-4.7)
**Validators**: ❌ Not integrated
**Interception**: ❌ Not working
**Prompts**: ❌ Not restricted

**Status**: Configuration is correct, but enforcement mechanisms are NOT in place.

**Critical Gap**: Validators exist but are NOT called. Oracle and Claude can still implement code.

**Risk Level**: HIGH - No automated enforcement of model responsibilities.

---

## Files to Modify

| Priority | File | Action | Status |
|----------|------|--------|--------|
| 1 | `src/shared/index.ts` | Add validator exports | ❌ TODO |
| 2 | `src/hooks/agent-output-validator/index.ts` | Create new hook | ❌ TODO |
| 3 | `src/agents/oracle.ts` | Add implementation prohibition | ❌ TODO |
| 4 | `src/agents/commander.ts` | Create agent with restrictions | ❌ TODO |
| 5 | Verify Codex permissions | Audit tool restrictions | ❌ TODO |

---

**Next Step**: Wait for user approval to implement Priority 1-5 fixes.
