# Tasks: Hook Reliability, Safety & Orchestration Guardrails

**Input**: Design documents from `.cursor/specs/LIF-63-feat-hook-reliability-safety-guardrails/`  
**Prerequisites**: plan.md (complete), spec.md (complete)  
**Linear Issue**: [LIF-63](https://linear.app/lifelogger/issue/LIF-63/hook-reliability-safety-and-orchestration-guardrails)

**Tests**: Not included (test framework not configured per constitution)

**Organization**: Tasks grouped by implementation phase, then by user story within each phase.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US8)
- Include exact file paths in descriptions

---

## Phase 1: Foundation - Hook Health Manager (Day 1-2)

**Purpose**: Create circuit breaker infrastructure that wraps ALL hook executions

**Blocks**: All other phases depend on this foundation

### Implementation

- [ ] T001 [US1] Create `src/hooks/hook-health-manager/types.ts` with HookHealthState, HookHealthConfig, HookHealthSummary interfaces
- [ ] T002 [US1] Create `src/hooks/hook-health-manager/constants.ts` with default config values (threshold: 3, slowHookMs: 1000)
- [ ] T003 [US1] Create `src/hooks/hook-health-manager/manager.ts` with HookHealthManager singleton class:
  - `isHookEnabled(hookName)` - circuit breaker check
  - `recordSuccess(hookName, latencyMs)` - success tracking
  - `recordFailure(hookName, error)` - failure tracking with consecutive counter
  - `getHealthSummary()` - session metrics
  - `resetForNewSession()` - session lifecycle
- [ ] T004 [US1] Create `src/hooks/hook-health-manager/index.ts` with exports
- [ ] T005 [US1] Integrate HookHealthManager into `src/index.ts`:
  - Wrap hook execution in try/catch
  - Call recordSuccess/recordFailure appropriately
  - Skip disabled hooks with warning log
- [ ] T006 [US1] Update `src/config/schema.ts` with governance.hook_health config section
- [ ] T007 [US1] Update `src/hooks/index.ts` to export hook-health-manager

**Checkpoint**: Circuit breaker functional - hooks auto-disable after 3 consecutive failures

---

## Phase 2: Safety Hooks (Day 3-5)

**Purpose**: Implement git safety and secret detection (US2, US3 - both P1)

### User Story 2 - Git Safety Validation (P1)

**Goal**: Block force push to protected branches, warn on destructive operations

**Independent Test**: Attempt `git push --force origin main` and verify blocked

- [ ] T010 [P] [US2] Create `src/hooks/git-safety-validator/types.ts` with GitSafetyConfig, GitSafetyResult interfaces
- [ ] T011 [P] [US2] Create `src/hooks/git-safety-validator/constants.ts` with:
  - Protected branches: ['main', 'master']
  - Dangerous commands: ['push --force', 'push -f', 'reset --hard']
  - Warning messages
- [ ] T012 [US2] Create `src/hooks/git-safety-validator/validator.ts` with:
  - `isForceOperation(command)` - detect force push
  - `isProtectedBranch(branch)` - check protected branches
  - `isDestructiveOperation(command)` - detect resets
  - `validateGitCommand(command)` - main validation logic
- [ ] T013 [US2] Create `src/hooks/git-safety-validator/index.ts` with createGitSafetyValidatorHook:
  - Hook into PreToolUse for Bash tool
  - Parse git commands from bash input
  - Block/warn based on validation result
  - Log audit trail for blocked operations
- [ ] T014 [US2] Update `src/hooks/index.ts` to export git-safety-validator
- [ ] T015 [US2] Update `src/config/schema.ts` with governance.git_safety config section

**Checkpoint**: Force push to main blocked with clear message

---

### User Story 3 - Secret Detection (P1)

**Goal**: Detect and block hardcoded secrets before commit or output

**Independent Test**: Write `API_KEY = "sk-..."` and verify commit blocked

- [ ] T020 [P] [US3] Create `src/hooks/security-scanner/types.ts` with:
  - SecretPattern interface (name, pattern, severity, description)
  - SecurityScannerConfig interface
  - SecretMatch interface
  - ScanResult interface
- [ ] T021 [P] [US3] Create `src/hooks/security-scanner/constants.ts` with default config
- [ ] T022 [US3] Create `src/hooks/security-scanner/patterns.ts` with secret patterns:
  - AWS keys: `AKIA[A-Z0-9]{16}`
  - JWT tokens: `eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*`
  - OpenAI keys: `sk-[A-Za-z0-9]{48}`
  - GitHub tokens: `gh[ps]_[A-Za-z0-9]{36,}`
  - Generic API keys: `(api[_-]?key|secret)["\s]*[:=]["\s]*["'][A-Za-z0-9]{20,}["']`
- [ ] T023 [US3] Create `src/hooks/security-scanner/scanner.ts` with:
  - `scanContent(content)` - scan text for secrets
  - `scanFile(filePath)` - scan file contents
  - `maskSecret(secret)` - mask for output display
  - `matchesAllowlist(match, allowlist)` - check allowlist
- [ ] T024 [US3] Create `src/hooks/security-scanner/index.ts` with createSecurityScannerHook:
  - Hook into PreToolUse for Write/Edit tools
  - Hook into PostToolUse to mask secrets in output
  - Block commits with detected secrets
  - Provide clear error with file/line/pattern info
- [ ] T025 [US3] Update `src/hooks/index.ts` to export security-scanner
- [ ] T026 [US3] Update `src/config/schema.ts` with governance.security_scanner config section

**Checkpoint**: Secrets detected and blocked with clear message showing pattern match

---

## Phase 3: Orchestration Guardrails (Day 6-8)

**Purpose**: Implement delegation tracking, turn limits, retry middleware (US4, US5, US8)

### Setup

- [ ] T030 Create `src/features/orchestration/` directory structure
- [ ] T031 [P] Create `src/features/orchestration/types.ts` with:
  - DelegationRecord interface
  - DelegationTrackerConfig interface
  - RetryConfig interface
  - MaxTurnsConfig interface

---

### User Story 4 - Delegation Loop Prevention (P2)

**Goal**: Prevent infinite A→B→A agent delegation loops

**Independent Test**: Create A→B→A delegation and verify blocked

- [ ] T040 [P] [US4] Create `src/features/orchestration/delegation-tracker.ts` with:
  - `DelegationTracker` class (singleton)
  - `canDelegate(fromAgent, toAgent)` - loop detection
  - `recordDelegation(fromAgent, toAgent)` - history tracking
  - `getDepth()` - current delegation depth
  - `getHistory()` - full delegation chain
  - `reset()` - session reset
- [ ] T041 [US4] Integrate DelegationTracker into `src/tools/call-omo-agent/tools.ts`:
  - Check canDelegate before spawning subagent
  - Record delegation on success
  - Block with clear message on loop detection
- [ ] T042 [US4] Integrate DelegationTracker into `src/tools/background-task/tools.ts`:
  - Same integration as T041

**Checkpoint**: A→B→A loop detected and blocked

---

### User Story 5 - Max Turns Enforcement (P2)

**Goal**: Limit agent conversation turns to prevent runaway token consumption

**Independent Test**: Set max_turns=5, verify agent stops at turn 5

- [ ] T050 [P] [US5] Create `src/features/orchestration/max-turns-enforcer.ts` with:
  - `MaxTurnsEnforcer` class
  - `incrementTurn()` - track conversation turn
  - `isLimitReached()` - check against max
  - `getTurnCount()` - current count
  - `getSummary()` - work done summary for termination message
- [ ] T051 [US5] Integrate MaxTurnsEnforcer into agent execution path:
  - Increment on each assistant message
  - Check limit before next turn
  - Generate termination summary when limit hit
- [ ] T052 [US5] Update `src/config/schema.ts` with orchestration.max_turns config (default: 10)

**Checkpoint**: Agent stops at turn limit with summary of work done

---

### User Story 8 - Retry Middleware with Backoff (P3)

**Goal**: Automatic retry with exponential backoff for transient failures

**Independent Test**: Mock tool to fail twice then succeed, verify transparent retry

- [ ] T060 [P] [US8] Create `src/features/orchestration/retry-middleware.ts` with:
  - `RetryMiddleware` class
  - `executeWithRetry<T>(fn, config)` - main retry logic
  - `calculateDelay(attempt)` - exponential backoff + jitter
  - `isRetryableError(error)` - error classification
  - `sleep(ms)` - delay utility
- [ ] T061 [US8] Define retryable vs non-retryable error patterns:
  - Retryable: timeout, rate_limit, connection_error, service_unavailable
  - Non-retryable: auth_error, invalid_input, permission_denied
- [ ] T062 [US8] Integrate RetryMiddleware into MCP tool calls in `src/mcp/`
- [ ] T063 [US8] Update `src/config/schema.ts` with orchestration.retry config section

**Checkpoint**: Transient failures automatically retried with backoff

---

### Orchestration Index

- [ ] T070 Create `src/features/orchestration/index.ts` exporting all middleware

---

## Phase 4: Conflict Detection & Monitoring (Day 9-10)

**Purpose**: Implement file conflict detection and performance monitoring (US6, US7)

### User Story 7 - Multi-Agent File Conflict Detection (P3)

**Goal**: Detect when multiple agents edit the same file concurrently

**Independent Test**: Start two agents editing same file, verify conflict warning

- [ ] T080 [P] [US7] Create `src/hooks/conflict-detector/types.ts` with FileEditLock interface
- [ ] T081 [P] [US7] Create `src/hooks/conflict-detector/constants.ts` with lock timeout, warning messages
- [ ] T082 [US7] Create `src/hooks/conflict-detector/registry.ts` with:
  - `FileEditRegistry` class (singleton)
  - `acquireLock(filePath, agentName)` - attempt to lock
  - `releaseLock(filePath, agentName)` - release lock
  - `hasConflict(filePath, agentName)` - check for conflict
  - `getActiveLocks()` - all current locks
- [ ] T083 [US7] Create `src/hooks/conflict-detector/index.ts` with createConflictDetectorHook:
  - Hook into PreToolUse for Write/Edit tools
  - Check for existing lock from different agent
  - Warn user with both agent names and file path
  - Acquire lock on proceed
- [ ] T084 [US7] Update `src/hooks/index.ts` to export conflict-detector

**Checkpoint**: Concurrent edit conflict detected and warned

---

### User Story 6 - Hook Performance Monitoring (P2)

**Goal**: Provide visibility into hook performance and errors

**Independent Test**: Run session, view performance summary at end

- [ ] T090 [P] [US6] Create `src/hooks/performance-monitor/types.ts` with metrics interfaces
- [ ] T091 [US6] Create `src/hooks/performance-monitor/collector.ts` with:
  - `MetricsCollector` class
  - `recordMetric(hookName, latencyMs, success)` - per-hook metrics
  - `getSlowHooks(thresholdMs)` - identify slow hooks
  - `getErrorProneHooks(threshold)` - identify failing hooks
  - `generateSummary()` - session-end report
- [ ] T092 [US6] Create `src/hooks/performance-monitor/index.ts` with createPerformanceMonitorHook:
  - Hook into session end event
  - Generate and display performance summary
  - Highlight slow hooks (>1s) and error-prone hooks
- [ ] T093 [US6] Update `src/hooks/index.ts` to export performance-monitor
- [ ] T094 [US6] Integrate with HookHealthManager from Phase 1 for metrics data

**Checkpoint**: Performance summary displayed at session end

---

## Phase 5: Polish & Integration

**Purpose**: Final integration, documentation, config updates

- [ ] T100 [P] Update README.md with new hooks documentation
- [ ] T101 [P] Update `src/config/schema.ts` with complete config schema for all new features
- [ ] T102 [P] Update `assets/oh-my-opencode.schema.json` via `bun run build:schema`
- [ ] T103 Verify all hooks registered in `src/index.ts`
- [ ] T104 Verify all exports in `src/hooks/index.ts`
- [ ] T105 Run typecheck: `bun run typecheck`
- [ ] T106 Run build: `bun run build`
- [ ] T107 Dogfood test: Use oh-my-opencode to verify hook behavior

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Foundation) ─────┬───→ Phase 2 (Safety)
                          │
                          ├───→ Phase 3 (Orchestration)
                          │
                          └───→ Phase 4 (Monitoring)
                                     ↓
                               Phase 5 (Polish)
```

- **Phase 1**: BLOCKS all other phases (foundation must be complete)
- **Phase 2-4**: Can run in parallel after Phase 1 (different directories)
- **Phase 5**: Depends on all phases complete

### User Story Independence

| Story | Phase | Can Start After | Independently Testable |
|-------|-------|-----------------|------------------------|
| US1 | 1 | - | Yes (circuit breaker works alone) |
| US2 | 2 | Phase 1 | Yes (git safety works alone) |
| US3 | 2 | Phase 1 | Yes (secret scan works alone) |
| US4 | 3 | Phase 1 | Yes (loop detection works alone) |
| US5 | 3 | Phase 1 | Yes (max turns works alone) |
| US6 | 4 | Phase 1 | Yes (metrics work alone) |
| US7 | 4 | Phase 1 | Yes (conflict detection works alone) |
| US8 | 3 | Phase 1 | Yes (retry works alone) |

### Parallel Opportunities

- All [P] tasks within same phase can run in parallel
- Phases 2, 3, 4 can run in parallel after Phase 1
- US2 and US3 (both Phase 2) can run in parallel
- US4, US5, US8 (all Phase 3) can run in parallel

---

## Task Summary

| Phase | Tasks | Duration | Stories |
|-------|-------|----------|---------|
| Phase 1 | T001-T007 (7 tasks) | 2 days | US1 |
| Phase 2 | T010-T026 (13 tasks) | 3 days | US2, US3 |
| Phase 3 | T030-T070 (12 tasks) | 3 days | US4, US5, US8 |
| Phase 4 | T080-T094 (10 tasks) | 2 days | US6, US7 |
| Phase 5 | T100-T107 (8 tasks) | 1 day | - |
| **Total** | **50 tasks** | **~11 days** | **8 stories** |

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story
- Each user story independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- All hooks follow `createXXXHook()` pattern from existing codebase
- Use Zod for all config validation
- No npm dependencies - Bun only
