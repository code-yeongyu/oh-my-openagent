# LIF-64: Implementation Plan - Fix Critical Hook Issues

**Linear Issue**: [LIF-64](https://linear.app/lifelogger/issue/LIF-64)
**Parent**: LIF-63 (Hook Reliability, Safety & Orchestration Guardrails)
**Created**: 2025-12-18
**Author**: Strategic Architect

---

## Re-Verification Summary (2025-12-18)

All 8 issues confirmed as **STILL PRESENT** via fresh code search:

| Issue | File:Line | Verified |
|-------|-----------|----------|
| Shell injection | git-safety-validator/index.ts:49 | ✅ `echo "${result.reason}..."` |
| Security scanner blocking | security-scanner/index.ts:76 | ✅ `output.args.content = "# BLOCKED..."` |
| Conflict detector blocking | conflict-detector/index.ts:64 | ✅ `output.args.content = "# BLOCKED..."` |
| `_agentName` missing | conflict-detector/index.ts:49,84 | ✅ Field doesn't exist |
| `safeHookCall` unused | index.ts:216 | ✅ Defined but never called |
| MaxTurnsEnforcer dead | orchestration/ | ✅ No getInstance/incrementTurn calls |
| RetryMiddleware dead | orchestration/ | ✅ Only defined in own file |
| Git parser quotes | git-safety-validator/validator.ts:23 | ✅ `split(/\s+/)` |

---

## Architecture Overview

### Current State (Broken)

```
┌─────────────────────────────────────────────────────────┐
│                    tool.execute.before                   │
├─────────────────────────────────────────────────────────┤
│  gitSafetyValidator  → modifies command (DOESN'T BLOCK) │
│  securityScanner     → modifies content (DOESN'T BLOCK) │
│  conflictDetector    → modifies content (DOESN'T BLOCK) │
│                        uses _agentName (DOESN'T EXIST)  │
└─────────────────────────────────────────────────────────┘
                            ↓
                   Tool STILL EXECUTES
```

### Target State (Fixed)

```
┌─────────────────────────────────────────────────────────┐
│                    tool.execute.before                   │
├─────────────────────────────────────────────────────────┤
│  safeHookCall("git-safety") →                           │
│    gitSafetyValidator  → throw Error (BLOCKS)           │
│  safeHookCall("security") →                             │
│    securityScanner     → throw Error (BLOCKS)           │
│  safeHookCall("conflict") →                             │
│    conflictDetector    → throw Error (BLOCKS)           │
│                          uses sessionID→agent mapping   │
└─────────────────────────────────────────────────────────┘
                            ↓
             Tool DOES NOT EXECUTE (on throw)
```

---

## Implementation Phases

### Phase 1: Security Fixes (CRITICAL - Do First)

**Estimated Time**: 2 hours
**Risk**: Medium (behavior change)

#### 1.1 Fix Git Safety Validator Blocking

**File**: `src/hooks/git-safety-validator/index.ts`

**Current (line 49)**:
```typescript
output.args.command = `echo "${result.reason}..." && exit 1`;
```

**Fixed**:
```typescript
throw new Error(`🚫 Git Safety: ${result.reason}\n\n💡 ${result.suggestion || ""}`);
```

**Also remove**: The `tool.execute.after` handler that adds tips to "BLOCKED:" output (no longer needed).

#### 1.2 Fix Security Scanner Blocking

**File**: `src/hooks/security-scanner/index.ts`

**Current (line 76)**:
```typescript
output.args.content = `# BLOCKED: Security scan failed...`;
```

**Fixed**:
```typescript
throw new Error(`🔐 Security Scan Failed:\n\n${errorMessage}`);
```

**For edit operations (lines 77-80)**, also throw instead of reverting:
```typescript
throw new Error(`🔐 Security: Cannot edit - secrets detected in new content`);
```

#### 1.3 Fix Conflict Detector Blocking

**File**: `src/hooks/conflict-detector/index.ts`

**Current (line 64)**:
```typescript
output.args.content = `# BLOCKED: File conflict detected...`;
```

**Fixed**:
```typescript
throw new Error(`⚠️ Conflict: ${warningMessage}`);
```

---

### Phase 2: Agent Detection Fix

**Estimated Time**: 1.5 hours
**Risk**: Low

#### 2.1 Create Session-Agent Registry

**New File**: `src/features/claude-code-session-state/agent-registry.ts`

```typescript
const sessionAgentMap = new Map<string, string>();

export function setSessionAgent(sessionId: string, agentName: string): void {
  sessionAgentMap.set(sessionId, agentName);
}

export function getAgentForSession(sessionId: string): string {
  return sessionAgentMap.get(sessionId) || "main";
}

export function clearSessionAgent(sessionId: string): void {
  sessionAgentMap.delete(sessionId);
}
```

#### 2.2 Inject Agent Name on Delegation

**File**: `src/tools/call-omo-agent/tools.ts`

When creating a subagent session, register the agent name:
```typescript
import { setSessionAgent } from "../../features/claude-code-session-state/agent-registry";

// In the tool execution:
setSessionAgent(newSessionId, args.subagent_type);
```

#### 2.3 Update Conflict Detector to Use Registry

**File**: `src/hooks/conflict-detector/index.ts`

```typescript
import { getAgentForSession } from "../../features/claude-code-session-state/agent-registry";

// In tool.execute.before:
const agentName = getAgentForSession(input.sessionID);

// In tool.execute.after - get from input, not metadata:
const agentName = getAgentForSession(input.sessionID);
```

---

### Phase 3: HookHealthManager Integration

**Estimated Time**: 1 hour
**Risk**: Low

#### 3.1 Define Critical Hooks Allowlist

Critical hooks should NEVER be disabled by circuit breaker:

```typescript
const CRITICAL_HOOKS = new Set([
  "governance-path-validator",
  "security-scanner",
  "git-safety-validator",
]);
```

#### 3.2 Wrap All Hooks with safeHookCall

**File**: `src/index.ts` (lines 600-646)

**Current**:
```typescript
await gitSafetyValidator?.["tool.execute.before"](input, output);
await securityScanner?.["tool.execute.before"](input, output);
```

**Fixed**:
```typescript
// Critical hooks - always run, no circuit breaker
await gitSafetyValidator?.["tool.execute.before"](input, output);
await securityScanner?.["tool.execute.before"](input, output);
await governancePathValidator?.["tool.execute.before"](input, output);

// Non-critical hooks - wrapped with circuit breaker
await safeHookCall("comment-checker", () => 
  commentChecker?.["tool.execute.before"](input, output));
await safeHookCall("conflict-detector", () =>
  conflictDetector?.["tool.execute.before"](input, output));
```

#### 3.3 Add Metrics Logging on Session End

In the `session.deleted` event handler, log hook health summary:
```typescript
if (hookHealthManager) {
  const summary = hookHealthManager.getHealthSummary();
  if (summary.disabledHooks.length > 0) {
    log("[HookHealth] Session end summary:", summary);
  }
  hookHealthManager.resetForNewSession();
}
```

---

### Phase 4: Orchestration Integration

**Estimated Time**: 2 hours
**Risk**: Medium

#### 4.1 Integrate MaxTurnsEnforcer

**File**: `src/index.ts` - in `event` handler

```typescript
import { MaxTurnsEnforcer } from "./features/orchestration";

// In session.created:
const enforcer = MaxTurnsEnforcer.getInstance(sessionId, {
  maxTurns: pluginConfig.governance?.max_turns ?? 50,
  warnAtTurn: pluginConfig.governance?.warn_at_turn ?? 40,
});

// In assistant message event (need to add handler):
if (event.type === "message.created" && props?.role === "assistant") {
  const enforcer = MaxTurnsEnforcer.getInstance(sessionId);
  enforcer.incrementTurn();
  
  if (enforcer.isLimitReached()) {
    // Inject termination message
    log("[MaxTurns] Limit reached:", enforcer.getTerminationMessage());
  }
}

// In session.deleted:
MaxTurnsEnforcer.removeInstance(sessionId);
```

#### 4.2 Integrate RetryMiddleware (Optional)

**File**: `src/mcp/index.ts` or MCP tool execution

Wrap MCP server connections with retry:
```typescript
import { RetryMiddleware } from "../features/orchestration";

const retry = new RetryMiddleware({
  maxRetries: 3,
  initialDelayMs: 1000,
});

// Wrap MCP calls:
const result = await retry.executeWithRetry(
  () => mcpClient.call(tool, args),
  `mcp:${serverName}:${tool}`
);
```

---

### Phase 5: Git Parser Fix

**Estimated Time**: 1 hour
**Risk**: Low

#### 5.1 Implement Proper Shell Parsing

**File**: `src/hooks/git-safety-validator/validator.ts`

Replace naive split with quote-aware parsing:

```typescript
function parseShellArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  
  for (const char of input) {
    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === " " || char === "\t") {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  
  if (current) {
    args.push(current);
  }
  
  return args;
}
```

**Update parseGitCommand**:
```typescript
// OLD: const parts = gitPart.split(/\s+/);
const parts = parseShellArgs(gitPart);
```

---

### Phase 6: Lock Leak Fix

**Estimated Time**: 30 minutes
**Risk**: Low

#### 6.1 Reorder Hooks

Move conflict-detector AFTER all validation hooks that might throw:

**File**: `src/index.ts`

```typescript
"tool.execute.before": async (input, output) => {
  // 1. Validation hooks that may throw (run first)
  await gitSafetyValidator?.["tool.execute.before"](input, output);
  await securityScanner?.["tool.execute.before"](input, output);
  await governancePathValidator?.["tool.execute.before"](input, output);
  
  // 2. Lock acquisition (only after validations pass)
  await conflictDetector?.["tool.execute.before"](input, output);
  
  // 3. Other hooks
  await commentChecker?.["tool.execute.before"](input, output);
  // ...
}
```

---

## Data Models

### Session-Agent Registry

```typescript
interface SessionAgentMapping {
  sessionId: string;
  agentName: string;
  parentSessionId?: string;
  createdAt: number;
}
```

### Critical Hooks Configuration

```typescript
interface HookSafetyConfig {
  criticalHooks: string[];  // Never disabled
  nonCriticalHooks: string[];  // Circuit breaker applies
}
```

---

## API Contracts

### Error Message Format

All blocking errors should follow consistent format:
```
[EMOJI] [HOOK_NAME]: [REASON]

💡 [SUGGESTION]
```

Examples:
- `🚫 Git Safety: Force push to 'main' is blocked`
- `🔐 Security: AWS access key detected in content`
- `⚠️ Conflict: File locked by 'explore' agent`

---

## Testing Strategy

### Manual Testing Checklist

1. **Shell injection test**: Create branch with backticks, verify no execution
2. **Blocking test**: Try to write file with AWS key, verify file NOT created
3. **Conflict test**: Run two agents editing same file, verify conflict detected
4. **Circuit breaker test**: Create failing hook, verify it gets disabled
5. **Turn limit test**: Set maxTurns=5, verify session terminates

### Verification Commands

```bash
# Type check
bun run typecheck

# Build
bun run build

# Test git safety (should throw, not execute)
# In OpenCode: git push --force origin main
```

---

## Implementation Order

| Order | Phase | Story | Priority | Est. Time |
|-------|-------|-------|----------|-----------|
| 1 | 1.1 | US1 | CRITICAL | 30m |
| 2 | 1.2 | US2 | CRITICAL | 30m |
| 3 | 1.3 | US2 | CRITICAL | 20m |
| 4 | 6.1 | US8 | HIGH | 20m |
| 5 | 2.1-2.3 | US3 | HIGH | 1.5h |
| 6 | 3.1-3.3 | US4 | HIGH | 1h |
| 7 | 5.1 | US7 | MEDIUM | 1h |
| 8 | 4.1 | US5 | MEDIUM | 1h |
| 9 | 4.2 | US6 | LOW | 1h |

**Total Estimated Time**: 7-8 hours

---

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Throw-based blocking breaks something | Medium | High | Test each hook individually |
| Session-agent mapping race conditions | Low | Medium | Use atomic operations |
| MaxTurns too aggressive | Medium | Low | Make configurable, default high |
| Breaking existing configurations | Low | High | Maintain backward compat |

---

## Dependencies

- OpenCode plugin system (confirmed via DeepWiki)
- Existing hook infrastructure
- Session state management

## Success Criteria

- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
- [ ] Shell injection impossible (verified manually)
- [ ] All blocking actually prevents execution
- [ ] Agent names correctly identified in conflicts
- [ ] Circuit breaker wraps all non-critical hooks
- [ ] No dead code remains
