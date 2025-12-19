# Implementation Plan: Hook Reliability, Safety & Orchestration Guardrails

**Branch**: `hello/lif-63-hook-reliability-safety-orchestration-guardrails` | **Date**: 2025-12-18 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `.cursor/specs/LIF-63-feat-hook-reliability-safety-guardrails/spec.md`

## Summary

Implement hook reliability mechanisms (circuit breaker, health monitoring), safety hooks (git-safety-validator, security-scanner), and orchestration guardrails (max_turns, delegation tracker, retry middleware) to enhance production stability and prevent costly failures in the oh-my-opencode plugin.

**Technical Approach**: 
1. Create a **HookHealthManager** wrapper that wraps all hook executions with circuit breaker and metrics collection
2. Implement 4 new hooks following existing `createXXXHook()` pattern
3. Add orchestration middleware in the agent delegation path
4. Integrate with existing governance hook infrastructure

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Plugin-First Architecture | **PASS** | All features via `@opencode-ai/plugin` SDK hooks/tools |
| II. Multi-Model Excellence | **N/A** | No new agents, infrastructure only |
| III. Multi-Layered Orchestration | **PASS** | Enhances orchestration with guardrails |
| IV. Bun-Native Development | **PASS** | Bun-only, no npm dependencies |
| V. Hook-Driven Enhancement | **PASS** | New hooks follow existing patterns |
| VI. Dogfooding | **PASS** | Will test by using oh-my-opencode to build |
| VII. GitHub Actions Publishing | **PASS** | No changes to publishing workflow |

**Verdict**: All constitution gates PASS. Proceed to Phase 0.

---

## Research

### Phase 0: Research Findings

**Existing Hook Infrastructure Analysis:**

Current hooks in `src/hooks/index.ts` (23 hooks):
1. **Context injection**: rules-injector, directory-agents-injector, directory-readme-injector
2. **QA/validation**: comment-checker, keyword-detector  
3. **Output management**: grep-output-truncator, tool-output-truncator
4. **Session**: session-recovery, session-notification, anthropic-auto-compact
5. **Agent enhancement**: think-mode, agent-usage-reminder, non-interactive-env
6. **Background**: background-notification, auto-update-checker
7. **Governance**: governance-path-validator, governance-historian, governance-linear-injector
8. **Claude Code compat**: claude-code-hooks
9. **Misc**: todo-continuation-enforcer, context-window-monitor, empty-task-response-detector, interactive-bash-session

**Hook Pattern Analysis (from `src/hooks/comment-checker/`):**
```typescript
// Standard hook structure
export function createXXXHook(input: PluginInput): HookHandlers {
  return {
    onSessionStart?: (session) => {},
    onToolResult?: (result, context) => {},
    onAssistantMessage?: (message, context) => {},
    // ... other event handlers
  };
}
```

**Existing Error Handling:**
- Hooks currently have no circuit breaker mechanism
- Failures propagate and can crash sessions
- No metrics collection for hook performance

**Research: Circuit Breaker Patterns (from deep review):**
- Swarm pattern: `max_turns` parameter with hard limit
- LangGraph: Cycle detection via state graph
- Anthropic: Checkpoints + summarization for recovery
- Best practice: Exponential backoff with jitter for retries

**Research: Secret Detection Patterns:**
- AWS patterns: `AKIA[A-Z0-9]{16}`, `[A-Za-z0-9/+=]{40}`
- JWT: `eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*`
- Generic API keys: `(api[_-]?key|apikey|secret)["\s]*[:=]["\s]*["'][A-Za-z0-9]{20,}["']`
- GitHub tokens: `gh[ps]_[A-Za-z0-9]{36,}`
- OpenAI: `sk-[A-Za-z0-9]{48}`

---

## Data Model

### HookHealthState

```typescript
interface HookHealthState {
  hookName: string;
  consecutiveFailures: number;
  totalInvocations: number;
  totalErrors: number;
  isDisabled: boolean;
  lastError?: {
    message: string;
    timestamp: number;
    stack?: string;
  };
  metrics: {
    avgLatencyMs: number;
    maxLatencyMs: number;
    p95LatencyMs: number;
    latencySamples: number[];
  };
}
```

### DelegationRecord

```typescript
interface DelegationRecord {
  fromAgent: string;
  toAgent: string;
  timestamp: number;
  depth: number;
  sessionId: string;
}
```

### FileEditLock

```typescript
interface FileEditLock {
  filePath: string;
  agentName: string;
  sessionId: string;
  acquiredAt: number;
  operation: 'read' | 'write' | 'edit';
}
```

### SecretMatch

```typescript
interface SecretMatch {
  pattern: string;
  patternName: string;
  line: number;
  column: number;
  preview: string; // Masked preview
  severity: 'critical' | 'high' | 'medium';
}
```

### HookHealthManager (Singleton)

```typescript
class HookHealthManager {
  private states: Map<string, HookHealthState>;
  private config: HookHealthConfig;
  
  // Circuit breaker
  isHookEnabled(hookName: string): boolean;
  recordSuccess(hookName: string, latencyMs: number): void;
  recordFailure(hookName: string, error: Error): void;
  
  // Metrics
  getHealthSummary(): HookHealthSummary;
  getSlowHooks(thresholdMs: number): HookHealthState[];
  getErrorProneHooks(threshold: number): HookHealthState[];
  
  // Session lifecycle
  resetForNewSession(): void;
}
```

---

## Contracts

### Hook Health Manager API

```typescript
// src/hooks/hook-health-manager/types.ts
export interface HookHealthConfig {
  circuitBreakerThreshold: number;  // Default: 3
  slowHookThresholdMs: number;      // Default: 1000
  metricsRetentionCount: number;    // Default: 100
  enableMetrics: boolean;           // Default: true
}

export interface HookHealthSummary {
  totalHooks: number;
  enabledHooks: number;
  disabledHooks: string[];
  slowestHooks: Array<{ name: string; avgLatencyMs: number }>;
  mostErrorProne: Array<{ name: string; errorRate: number }>;
  sessionStats: {
    totalInvocations: number;
    totalErrors: number;
    avgLatencyMs: number;
  };
}
```

### Git Safety Validator Hook

```typescript
// src/hooks/git-safety-validator/types.ts
export interface GitSafetyConfig {
  protectedBranches: string[];  // Default: ['main', 'master']
  blockForceOperations: boolean; // Default: true
  warnOnDestructive: boolean;    // Default: true
  allowListPatterns: string[];   // Regex patterns to skip
}

export interface GitSafetyResult {
  allowed: boolean;
  reason?: string;
  suggestion?: string;
  requiresConfirmation?: boolean;
}
```

### Security Scanner Hook

```typescript
// src/hooks/security-scanner/types.ts
export interface SecurityScannerConfig {
  enabled: boolean;
  patterns: SecretPattern[];
  allowListPatterns: string[];
  scanOnCommit: boolean;
  scanOnOutput: boolean;
  maskInOutput: boolean;
}

export interface SecretPattern {
  name: string;
  pattern: RegExp;
  severity: 'critical' | 'high' | 'medium';
  description: string;
}

export interface ScanResult {
  hasSecrets: boolean;
  matches: SecretMatch[];
  scannedFiles: number;
  scanDurationMs: number;
}
```

### Delegation Tracker

```typescript
// src/features/orchestration/delegation-tracker.ts
export interface DelegationTrackerConfig {
  maxDepth: number;           // Default: 5
  detectLoops: boolean;       // Default: true
  warnOnDeepChain: boolean;   // Default: true
}

export interface DelegationCheckResult {
  allowed: boolean;
  reason?: string;
  depth: number;
  history: DelegationRecord[];
}
```

### Retry Middleware

```typescript
// src/features/orchestration/retry-middleware.ts
export interface RetryConfig {
  maxRetries: number;           // Default: 3
  initialDelayMs: number;       // Default: 1000
  maxDelayMs: number;           // Default: 30000
  backoffFactor: number;        // Default: 2
  jitterFactor: number;         // Default: 0.1
  retryableErrors: string[];    // Error types to retry
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  attempts: number;
  totalDelayMs: number;
  lastError?: Error;
}
```

---

## Technical Context

**Language/Version**: TypeScript 5.7+  
**Runtime**: Bun >= 1.0.0  
**Primary Dependencies**: @opencode-ai/plugin ^1.0.150, Zod ^4.1.8  
**Storage**: In-memory (per-session state)  
**Testing**: Not configured (manual dogfooding)  
**Target Platform**: OpenCode plugin (cross-platform)  
**Project Type**: Single TypeScript library  
**Performance Goals**: <50ms hook overhead per invocation  
**Constraints**: No external runtime dependencies, Bun-only  
**Scale/Scope**: 23 existing hooks + 4 new hooks + 3 middleware components

---

## Project Structure

### Documentation (this feature)

```text
.cursor/specs/LIF-63-feat-hook-reliability-safety-guardrails/
├── spec.md              # Feature specification (complete)
├── plan.md              # This file
├── tasks.md             # Task breakdown (next phase)
├── status.md            # Feature status tracking
└── changelog/           # Feature changelog entries
    └── 2025-12-18__product-strategist__spec-creation.md
```

### Source Code (repository root)

```text
src/
├── hooks/
│   ├── hook-health-manager/          # NEW: Circuit breaker + metrics
│   │   ├── index.ts                  # Export createHookHealthManager
│   │   ├── types.ts                  # HookHealthState, Config interfaces
│   │   ├── constants.ts              # Default config values
│   │   └── manager.ts                # HookHealthManager class
│   │
│   ├── git-safety-validator/         # NEW: Git operation safety
│   │   ├── index.ts                  # Export createGitSafetyValidatorHook
│   │   ├── types.ts                  # GitSafetyConfig, Result interfaces
│   │   ├── constants.ts              # Protected branches, dangerous commands
│   │   └── validator.ts              # Validation logic
│   │
│   ├── security-scanner/             # NEW: Secret detection
│   │   ├── index.ts                  # Export createSecurityScannerHook
│   │   ├── types.ts                  # ScanConfig, SecretMatch interfaces
│   │   ├── constants.ts              # Secret patterns (AWS, JWT, etc.)
│   │   ├── patterns.ts               # Pattern definitions
│   │   └── scanner.ts                # Scanning logic
│   │
│   ├── conflict-detector/            # NEW: Multi-agent file locking
│   │   ├── index.ts                  # Export createConflictDetectorHook
│   │   ├── types.ts                  # FileEditLock interfaces
│   │   ├── constants.ts              # Lock timeout, warning messages
│   │   └── registry.ts               # FileEditRegistry class
│   │
│   ├── performance-monitor/          # NEW: Hook performance tracking
│   │   ├── index.ts                  # Export createPerformanceMonitorHook
│   │   ├── types.ts                  # Metrics interfaces
│   │   └── collector.ts              # MetricsCollector class
│   │
│   └── index.ts                      # Update exports for new hooks
│
├── features/
│   └── orchestration/                # NEW: Orchestration guardrails
│       ├── index.ts                  # Export all middleware
│       ├── delegation-tracker.ts     # Loop detection + depth tracking
│       ├── max-turns-enforcer.ts     # Turn limit enforcement
│       ├── retry-middleware.ts       # Exponential backoff + jitter
│       └── types.ts                  # Shared types
│
├── config/
│   └── schema.ts                     # Update with new config options
│
└── index.ts                          # Register new hooks + middleware
```

**Structure Decision**: Single TypeScript library following existing oh-my-opencode patterns. New hooks follow the established `createXXXHook()` pattern with directory structure: index.ts, types.ts, constants.ts, and implementation files.

---

## Implementation Phases

### Phase 1: Hook Health Manager (Foundation) - Day 1-2

**Components:**
1. `HookHealthManager` singleton class
2. Circuit breaker logic (consecutive failures tracking)
3. Basic metrics collection (invocations, errors, latency)
4. Integration point in main plugin event handler

**Dependencies:** None (foundation layer)

**Deliverables:**
- `src/hooks/hook-health-manager/` directory
- Update `src/index.ts` to wrap hook executions
- Config schema updates for `governance.hook_health`

### Phase 2: Safety Hooks - Day 3-5

**Components:**
1. `git-safety-validator` hook
   - Block force push to protected branches
   - Warn on destructive operations
   - Audit logging
2. `security-scanner` hook
   - Pattern-based secret detection
   - Pre-commit interception
   - Output masking

**Dependencies:** Phase 1 (hooks should be wrapped by health manager)

**Deliverables:**
- `src/hooks/git-safety-validator/` directory
- `src/hooks/security-scanner/` directory
- Update `src/hooks/index.ts` with new exports
- Config schema updates for safety options

### Phase 3: Orchestration Guardrails - Day 6-8

**Components:**
1. `delegation-tracker` middleware
   - Track A->B delegations
   - Detect and block loops
   - Warn on deep chains (>5)
2. `max-turns-enforcer` middleware
   - Track conversation turns
   - Enforce configurable limit
   - Provide summary on termination
3. `retry-middleware`
   - Exponential backoff with jitter
   - Error classification (retryable vs permanent)
   - Max attempts limit

**Dependencies:** Phase 1 (uses health manager for metrics)

**Deliverables:**
- `src/features/orchestration/` directory
- Integration with agent delegation path
- Config schema updates for guardrails

### Phase 4: Conflict Detection + Monitoring - Day 9-10

**Components:**
1. `conflict-detector` hook
   - File edit registry (in-memory)
   - Concurrent edit detection
   - Warning generation
2. `performance-monitor` hook
   - Session-end summary
   - Slow hook identification
   - Error-prone hook identification

**Dependencies:** Phase 1 (uses health manager data)

**Deliverables:**
- `src/hooks/conflict-detector/` directory
- `src/hooks/performance-monitor/` directory
- Session-end hook for summary output

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Circuit breaker too aggressive | Configurable threshold (default 3), reset on success |
| False positives in secret detection | Allowlist mechanism, pattern tuning, user override |
| Performance overhead | Async execution, lazy evaluation, opt-out config |
| Breaking existing hooks | Incremental rollout, comprehensive testing |

---

## Acceptance Criteria (from spec.md)

1. **Hook circuit breaker**: Hooks disabled after 3 consecutive failures
2. **Git safety**: Force push to main/master blocked 100%
3. **Secret detection**: 90%+ common patterns detected
4. **Delegation loops**: 100% of A->B->A loops blocked
5. **Max turns**: Conversations stop within 1 turn of limit
6. **Performance**: Hook overhead <50ms per invocation average
7. **Conflict detection**: 100% concurrent same-file edits detected

---

## Handoff to Implementation

**Ready for `/tasks`**: Create task breakdown with:
- Individual tasks for each hook
- Configuration schema updates
- Integration points
- Testing scenarios (dogfooding)

**Implementation Specialist Notes:**
- Follow existing hook patterns in `src/hooks/comment-checker/`
- Use Zod for config validation
- No npm dependencies (Bun-only)
- Export via barrel pattern in `src/hooks/index.ts`
