# Fix Governance Hook Blocking Document-Writer

**Linear Issue**: [LIF-70](https://linear.app/lifelogger/issue/LIF-70)
**Created**: 2025-12-21
**Status**: Draft
**Type**: Bug Fix

## Overview

The `governance-docs-delegation` hook incorrectly blocks `document-writer` and `docs-publisher` agents from writing documentation files. When these allowed agents attempt to write `.md` files, the hook throws a circular error telling them to delegate to themselves.

## Problem Statement

### Current State (Broken)

1. `governance-docs-delegation` hook intercepts `write`/`edit` tool calls for docs paths
2. Hook calls `isAllowedAgent(sessionId)` to check if agent is permitted
3. `isAllowedAgent()` calls `getAgentForSession(sessionId)` from agent-registry
4. **BUG**: `BackgroundManager.launch()` never calls `setSessionAgent()`
5. **RESULT**: `getAgentForSession()` returns `"main"` for background agents
6. **RESULT**: `isAllowedAgent()` returns `false`, hook blocks the write

### Error Message

```
[Governance] Operation blocked: Documentation changes must be delegated to document-writer.
Path: docs/some-file.md
Remediation: task(subagent_type="document-writer", prompt="Write/update docs/some-file.md")
```

This is circular — the hook tells you to delegate to `document-writer` when `document-writer` itself is trying to write.

### Root Cause Analysis

**File: `src/features/background-agent/manager.ts`**
- `launch()` creates a new session and prompts it with the agent
- Never calls `setSessionAgent(sessionID, input.agent)`
- Session agent mapping is missing

**File: `src/features/claude-code-session-state/agent-registry.ts`**
- `getAgentForSession()` returns `"main"` when no mapping exists
- No mechanism to detect agent from session context

**File: `src/hooks/governance-docs-delegation/index.ts`**
- `isAllowedAgent()` depends entirely on session-agent mapping
- No fallback detection mechanism

## User Stories

- As a developer, I want `document-writer` to write `.md` files without being blocked
- As a developer, I want `docs-publisher` to write `.md` files without being blocked
- As a developer, I want the governance hook to correctly identify background agents
- As a developer, I want non-allowed agents to still be blocked from writing docs

## Requirements

### Functional Requirements

1. `BackgroundManager.launch()` MUST call `setSessionAgent(sessionID, agentName)` when launching a background agent
2. Session agent registration MUST happen before the prompt is sent
3. Allowed agents (`document-writer`, `docs-publisher`) MUST be able to write docs
4. Non-allowed agents MUST still be blocked

### Non-Functional Requirements

1. Changes should be minimal and surgical
2. No changes to hook logic — fix is in agent registration
3. Solution should work for both sync and async agent modes

## Scope

### In Scope

1. Fix `BackgroundManager.launch()` to register session agent
2. Verify fix works for background agent mode
3. Test that allowed agents can write docs
4. Test that non-allowed agents are still blocked

### Out of Scope

- Modifying the governance hook logic itself
- Adding new allowed agents
- Changing path patterns or exceptions
- OpenCode's builtin Task tool (separate issue if needed)

## Files to Modify

| File | Change |
|------|--------|
| `src/features/background-agent/manager.ts` | Add `setSessionAgent()` call in `launch()` |

## Acceptance Criteria

- [ ] `document-writer` can write `.md` files without being blocked
- [ ] `docs-publisher` can write `.md` files without being blocked  
- [ ] Background agent mode correctly registers session agent
- [ ] Non-allowed agents are still blocked from writing docs
- [ ] Hook still blocks main session from writing docs directly
- [ ] Build passes after changes

## Technical Fix

### Location: `src/features/background-agent/manager.ts` (line ~86)

**Before:**
```typescript
const sessionID = createResult.data.id

const task: BackgroundTask = {
  // ...
}

this.tasks.set(task.id, task)
```

**After:**
```typescript
const sessionID = createResult.data.id

// LIF-70: Register session agent for governance hooks
setSessionAgent(sessionID, input.agent)

const task: BackgroundTask = {
  // ...
}

this.tasks.set(task.id, task)
```

### Import Required
```typescript
import { setSessionAgent } from "../claude-code-session-state/agent-registry"
```

## Assumptions

1. The `setSessionAgent()` function works correctly
2. Session ID is available before the prompt is sent
3. Agent name from `input.agent` matches the agent registry names

## References

- **Hook implementation**: `src/hooks/governance-docs-delegation/index.ts`
- **Agent registry**: `src/features/claude-code-session-state/agent-registry.ts`
- **Background manager**: `src/features/background-agent/manager.ts`
- **Allowed agents**: `["document-writer", "docs-publisher"]` in `types.ts`
