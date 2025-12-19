# LIF-64: Fix Critical Issues in LIF-63 Hook Reliability Implementation

**Linear Issue**: [LIF-64](https://linear.app/lifelogger/issue/LIF-64)
**Parent Issue**: LIF-63 (Hook Reliability, Safety & Orchestration Guardrails)
**Type**: Bug Fix / Security Remediation
**Priority**: Critical
**Branch**: `hello/lif-64-fix-critical-issues-in-lif-63-hook-reliability`
**Created**: 2025-12-18
**Status**: Verified

---

## Problem Statement

The LIF-63 implementation introduced hook reliability, safety validation, and orchestration guardrails, but extensive code review and DeepWiki verification revealed critical security vulnerabilities, non-functional components, and logic errors that must be fixed before the feature can be used safely.

## Evidence Summary

| Finding | Verification Method | Status |
|---------|-------------------|--------|
| Shell injection vulnerability | Code inspection | Confirmed |
| Blocking mechanism doesn't work | DeepWiki query | Confirmed - must throw errors |
| `_agentName` field doesn't exist | Grep search | Confirmed - only 2 refs in conflict-detector |
| `safeHookCall` never used | Grep search | Confirmed - defined but never called |
| MaxTurnsEnforcer dead code | Grep search | Confirmed - no calls found |
| RetryMiddleware dead code | Grep search | Confirmed - only exports, no usage |

---

## User Stories

### US1: Security - Eliminate Shell Injection Vulnerability

**As a** developer using oh-my-opencode  
**I want** the git safety validator to block dangerous operations safely  
**So that** malicious input cannot execute arbitrary shell commands  

**Acceptance Criteria:**
- [ ] Git safety validator throws an error instead of rewriting command
- [ ] No string interpolation into shell commands
- [ ] Error message clearly indicates why operation was blocked
- [ ] Blocked operations do not execute under any circumstances

**Current Behavior (BROKEN):**
```typescript
// src/hooks/git-safety-validator/index.ts:53
output.args.command = `echo "${result.reason}..." && exit 1`;
// VULNERABILITY: Branch names with quotes/backticks can inject commands
```

**Required Behavior:**
```typescript
throw new Error(`Git operation blocked: ${result.reason}`);
```

---

### US2: Security - Fix Blocking Mechanism Across All Hooks

**As a** developer using oh-my-opencode  
**I want** hooks that block operations to actually prevent execution  
**So that** security and safety measures are effective  

**Acceptance Criteria:**
- [ ] All blocking hooks use `throw new Error()` pattern
- [ ] Security scanner throws on critical secret detection
- [ ] Conflict detector throws when blocking is enabled
- [ ] Git safety validator throws for blocked operations
- [ ] No hook modifies content to "fake" blocking

**Affected Hooks:**
1. `git-safety-validator` - Currently rewrites to echo command
2. `security-scanner` - Currently writes `# BLOCKED...` to file
3. `conflict-detector` - Currently writes `# BLOCKED...` to content

**DeepWiki Confirmation:**
> "The proper way to block a tool from executing in a plugin hook is to throw an error within the `tool.execute.before` hook. When an error is thrown, the tool's `execute` function will not be called."

---

### US3: Functionality - Fix Agent Name Detection in Conflict Detector

**As a** developer using oh-my-opencode with multiple agents  
**I want** the conflict detector to correctly identify which agent is editing a file  
**So that** file conflicts between agents are properly detected and handled  

**Acceptance Criteria:**
- [ ] Agent name is correctly identified for each file operation
- [ ] Lock acquisition uses correct agent identity
- [ ] Lock release uses correct agent identity
- [ ] Conflicts are detected between different agents, not "unknown" vs "unknown"

**Current Behavior (BROKEN):**
```typescript
// src/hooks/conflict-detector/index.ts:45
const agentName = (output.args._agentName as string) || "unknown";
// BUG: _agentName doesn't exist - always returns "unknown"
```

---

### US4: Functionality - Integrate HookHealthManager

**As a** developer using oh-my-opencode  
**I want** the circuit breaker to actually protect against failing hooks  
**So that** a misbehaving hook doesn't crash the entire system  

**Acceptance Criteria:**
- [ ] All hooks in `tool.execute.before` wrapped with `safeHookCall`
- [ ] All hooks in `tool.execute.after` wrapped with `safeHookCall`
- [ ] Failed hooks are tracked and disabled after threshold
- [ ] Critical safety hooks (governance, security) are never disabled
- [ ] Hook health metrics are collected

**Current Behavior (BROKEN):**
```typescript
// src/index.ts:216 - Defined but never used
async function safeHookCall<T>(...)

// src/index.ts:601-607 - Hooks called directly without wrapper
await gitSafetyValidator?.["tool.execute.before"](input, output);
```

---

### US5: Functionality - Integrate MaxTurnsEnforcer

**As a** developer using oh-my-opencode  
**I want** agent conversations to be limited to prevent runaway loops  
**So that** agents don't consume infinite resources on stuck tasks  

**Acceptance Criteria:**
- [ ] MaxTurnsEnforcer instantiated per session
- [ ] Turn count incremented on each agent message
- [ ] Warning issued when approaching limit
- [ ] Session terminates with summary when limit reached
- [ ] Turn limit is configurable

---

### US6: Functionality - Integrate RetryMiddleware

**As a** developer using oh-my-opencode  
**I want** transient failures to be automatically retried  
**So that** temporary network issues don't fail important operations  

**Acceptance Criteria:**
- [ ] RetryMiddleware wraps MCP tool calls
- [ ] Exponential backoff with jitter applied
- [ ] Non-retryable errors fail immediately
- [ ] Retry attempts logged for debugging

---

### US7: Reliability - Fix Git Command Parser

**As a** developer using oh-my-opencode  
**I want** the git safety validator to correctly parse all git commands  
**So that** complex commands are properly validated  

**Acceptance Criteria:**
- [ ] Commands with quoted arguments parsed correctly
- [ ] `git commit -m "fix bug"` handled properly
- [ ] Multi-command chains detected and handled

**Current Behavior (BROKEN):**
```typescript
// Splits "git commit -m 'fix bug'" incorrectly
const parts = gitPart.split(/\s+/);
```

---

### US8: Reliability - Fix Lock Leak on Hook Abort

**As a** developer using oh-my-opencode  
**I want** file locks to be properly released even when later hooks fail  
**So that** stale locks don't cause false conflict errors  

**Acceptance Criteria:**
- [ ] Lock acquisition happens after validation hooks OR
- [ ] Lock release guaranteed via try/finally
- [ ] Stale lock cleanup runs on session start

---

## Functional Requirements

### FR1: Throw-Based Blocking (Critical)
All hooks that need to block operations MUST throw an error. Modifying `output.args` changes what gets passed but does NOT prevent execution.

### FR2: Agent Context Propagation
Session ID to agent name mapping must be established and used by conflict detector.

### FR3: Circuit Breaker Integration
`safeHookCall` wrapper must be applied to all non-critical hooks with an allowlist for safety-critical hooks.

### FR4: Orchestration Pipeline Integration
MaxTurnsEnforcer must hook into session events to track turns.

---

## Non-Functional Requirements

### NFR1: Security
- No shell injection vulnerabilities
- No command injection via user input

### NFR2: Reliability  
- Hooks that fail don't crash the system
- Locks are cleaned up properly

### NFR3: Maintainability
- Dead code is either integrated or removed
- Clear documentation of hook behavior

---

## Out of Scope

- New features beyond LIF-63 scope
- Changes to OpenCode core
- Performance optimizations beyond bug fixes
- Additional secret patterns

## Assumptions

1. OpenCode throws errors block execution (verified via DeepWiki)
2. Session IDs are stable for agent lookup
3. Hook order can be modified in src/index.ts

## Technical Constraints

1. Must use Bun (not npm/yarn)
2. Must follow existing createXXXHook pattern
3. Cannot modify OpenCode core

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Shell injection vulnerabilities | 0 |
| Blocked operations actually prevented | 100% |
| Correct agent identification | 100% |
| Hooks wrapped with circuit breaker | All non-critical |
| Dead code | 0 unused components |

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing functionality | Medium | High | Careful testing |
| Session-agent mapping difficult | Medium | Medium | Fallback to defaults |
