# Feature Specification: Hook Reliability, Safety & Orchestration Guardrails

**Feature ID**: `LIF-63-feat-hook-reliability-safety-guardrails`  
**Created**: 2025-12-18  
**Status**: Draft  
**Parent Issue**: LIF-62 (Multi-Layered Agent Orchestration Enhancement)  
**Input**: Deep code review findings from analysis of 23+ agents, 21 hooks, 30+ tools

## Executive Summary

This specification defines requirements for implementing hook reliability mechanisms, safety hooks, and orchestration guardrails discovered during deep code review of oh-my-opencode. These enhancements extend the parent initiative (LIF-62) with critical infrastructure for production stability and safety.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Hook Circuit Breaker Protection (Priority: P1)

As a developer using oh-my-opencode, I want hooks that fail repeatedly to be automatically disabled for the session so that one broken hook doesn't crash my entire workflow.

**Why this priority**: Hook failures currently can cascade and break sessions. This is a critical reliability improvement that affects every user.

**Independent Test**: Can be fully tested by intentionally creating a hook that throws errors and verifying it gets disabled after N failures while other hooks continue working.

**Acceptance Scenarios**:

1. **Given** a hook that throws an error 3 consecutive times, **When** the 4th invocation occurs, **Then** the hook is disabled for the remainder of the session and a warning is logged.
2. **Given** a disabled hook, **When** a new session starts, **Then** the hook is re-enabled (fresh start).
3. **Given** a hook that fails intermittently (not consecutive), **When** it succeeds between failures, **Then** the failure counter resets and the hook remains active.

---

### User Story 2 - Git Safety Validation (Priority: P1)

As a developer, I want the system to prevent dangerous git operations (force push to protected branches, destructive resets) so that I don't accidentally destroy work.

**Why this priority**: Accidental force pushes or resets can cause irreversible data loss. This is a critical safety feature.

**Independent Test**: Can be tested by attempting to run `git push --force origin main` and verifying it is blocked with a clear error message.

**Acceptance Scenarios**:

1. **Given** a user attempts `git push --force` to `main` or `master`, **When** the command is intercepted, **Then** the operation is blocked with explanation and safe alternative suggested.
2. **Given** a user attempts `git reset --hard` on a branch with uncommitted changes, **When** the command is intercepted, **Then** the user is warned and asked for explicit confirmation.
3. **Given** a user explicitly requests a force operation with confirmation, **When** the confirmation is provided, **Then** the operation proceeds with audit logging.

---

### User Story 3 - Secret Detection (Priority: P1)

As a developer, I want the system to detect and prevent hardcoded secrets (API keys, tokens, passwords) from being committed or output so that I don't accidentally expose sensitive data.

**Why this priority**: Secret leakage is a critical security vulnerability. Detection before commit prevents security incidents.

**Independent Test**: Can be tested by writing code with a pattern like `API_KEY = "sk-..."` and verifying the security scanner blocks the commit.

**Acceptance Scenarios**:

1. **Given** code containing a pattern matching known secret formats (AWS keys, API tokens, JWT secrets), **When** the file is about to be committed, **Then** the commit is blocked with details of the detected secret.
2. **Given** a false positive detection (e.g., example placeholder), **When** the user adds the pattern to allowlist, **Then** subsequent commits proceed normally.
3. **Given** agent output containing a secret pattern, **When** the output is generated, **Then** the secret is masked with `[REDACTED]` placeholder.

---

### User Story 4 - Delegation Loop Prevention (Priority: P2)

As a developer, I want the system to prevent infinite agent delegation loops (A->B->A->B...) so that runaway agent calls don't consume tokens and time indefinitely.

**Why this priority**: Delegation loops can consume significant tokens/cost and hang sessions. Prevention is important for cost control.

**Independent Test**: Can be tested by creating a scenario where Agent A delegates to Agent B which delegates back to Agent A, and verifying the loop is detected and stopped.

**Acceptance Scenarios**:

1. **Given** Agent A delegates to Agent B, **When** Agent B attempts to delegate back to Agent A, **Then** the delegation is blocked with "delegation loop detected" message.
2. **Given** a legitimate A->B->C->D chain, **When** the chain depth exceeds 5 levels, **Then** a warning is issued but delegation proceeds.
3. **Given** a delegation loop is detected, **When** the loop is blocked, **Then** the delegation history is logged for debugging.

---

### User Story 5 - Max Turns Enforcement (Priority: P2)

As a developer, I want agent conversations to have a maximum turn limit so that runaway conversations don't consume unlimited tokens.

**Why this priority**: Unbounded conversations can be costly and indicate stuck agents. Turn limits provide guardrails.

**Independent Test**: Can be tested by setting max_turns=5 and verifying the agent stops after 5 turns with a clear message.

**Acceptance Scenarios**:

1. **Given** max_turns is set to 10 (default), **When** an agent reaches 10 turns, **Then** the agent stops with "max turns exceeded" message and summary of work done.
2. **Given** max_turns is set to 20 for a complex task, **When** the agent completes in 15 turns, **Then** the agent completes normally without hitting the limit.
3. **Given** max_turns is exceeded, **When** the user wants to continue, **Then** the user can explicitly extend with a new request.

---

### User Story 6 - Hook Performance Monitoring (Priority: P2)

As a developer, I want to see which hooks are slow or failing so that I can optimize or disable problematic hooks.

**Why this priority**: Visibility into hook performance helps diagnose slow sessions and identify optimization opportunities.

**Independent Test**: Can be tested by running a session and viewing the hook performance summary showing invocation counts, latencies, and error rates.

**Acceptance Scenarios**:

1. **Given** a session with multiple hook invocations, **When** the session ends, **Then** a performance summary shows per-hook metrics (count, avg latency, error rate).
2. **Given** a hook takes >1 second to execute, **When** the hook completes, **Then** a warning is logged with the slow hook name and duration.
3. **Given** hook metrics are collected, **When** a user requests diagnostics, **Then** top 5 slowest hooks and top 5 most-erroring hooks are displayed.

---

### User Story 7 - Multi-Agent File Conflict Detection (Priority: P3)

As a developer using multiple parallel agents, I want the system to detect when two agents are trying to edit the same file so that I don't get corrupted or lost changes.

**Why this priority**: Parallel agent work can cause conflicts. Detection prevents data loss but is less critical than safety features.

**Independent Test**: Can be tested by starting two background agents that both try to edit the same file and verifying a conflict warning is raised.

**Acceptance Scenarios**:

1. **Given** Agent A is editing `src/file.ts`, **When** Agent B attempts to edit the same file, **Then** a conflict warning is raised with both agent names.
2. **Given** a conflict is detected, **When** the user chooses to proceed, **Then** the second agent's changes are applied with a backup of the first agent's version.
3. **Given** agents are editing different files, **When** both complete, **Then** no conflict warnings are raised.

---

### User Story 8 - Retry Middleware with Backoff (Priority: P3)

As a developer, I want failed tool calls to automatically retry with exponential backoff so that transient errors don't fail my workflow.

**Why this priority**: Transient API/tool errors are common. Automatic retry improves reliability without user intervention.

**Independent Test**: Can be tested by mocking a tool to fail twice then succeed, and verifying the retry middleware handles it transparently.

**Acceptance Scenarios**:

1. **Given** a tool call fails with a transient error (timeout, rate limit), **When** the retry middleware intercepts, **Then** the call is retried with exponential backoff (1s, 2s, 4s...).
2. **Given** a tool call fails 3 times, **When** the 4th attempt also fails, **Then** the error is surfaced to the user with "max retries exceeded" message.
3. **Given** a permanent error (auth failure, invalid input), **When** the retry middleware intercepts, **Then** the error is immediately surfaced without retry.

---

### Edge Cases

- What happens when a hook circuit breaker triggers during a critical operation?
  - The operation continues without the failed hook; user is notified
- How does secret detection handle base64-encoded secrets?
  - Pattern matching includes common encoding formats
- What happens when max_turns is hit mid-task?
  - Agent provides summary of completed work and remaining tasks
- How does conflict detection work with nested file edits (imports)?
  - Only direct file edits are tracked, not transitive dependencies

---

## Requirements *(mandatory)*

### Functional Requirements

**Hook Reliability:**
- **FR-001**: System MUST track consecutive failures per hook per session
- **FR-002**: System MUST disable hooks after configurable N consecutive failures (default: 3)
- **FR-003**: System MUST log hook disablement with reason and recovery instructions
- **FR-004**: System MUST re-enable all hooks on new session start
- **FR-005**: System MUST provide hook health status endpoint/summary

**Safety Hooks:**
- **FR-010**: System MUST block `git push --force` to protected branches (main, master)
- **FR-011**: System MUST warn on `git reset --hard` with uncommitted changes
- **FR-012**: System MUST detect secrets matching common patterns (API keys, tokens, JWTs)
- **FR-013**: System MUST block commits containing detected secrets
- **FR-014**: System MUST mask secrets in agent output with `[REDACTED]`
- **FR-015**: System MUST allow user-defined secret allowlist patterns

**Orchestration Guardrails:**
- **FR-020**: System MUST enforce max_turns limit (default: 10, configurable)
- **FR-021**: System MUST track delegation history per session
- **FR-022**: System MUST detect and block A->B->A delegation loops
- **FR-023**: System MUST warn on delegation depth > 5
- **FR-024**: System MUST provide retry middleware with exponential backoff + jitter

**Conflict Detection:**
- **FR-030**: System MUST track active file edits per agent per session
- **FR-031**: System MUST detect concurrent edits to same file by different agents
- **FR-032**: System MUST warn user with agent names and file path on conflict

**Performance Monitoring:**
- **FR-040**: System MUST track per-hook execution time
- **FR-041**: System MUST track per-hook invocation count
- **FR-042**: System MUST track per-hook error count
- **FR-043**: System MUST provide session-end performance summary

### Key Entities

- **HookHealthState**: Tracks failure counts, disabled status, last error per hook
- **DelegationTracker**: Tracks from->to delegations with timestamps
- **FileEditRegistry**: Tracks active file edits per agent
- **PerformanceMetrics**: Aggregates timing and error data per hook/tool

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Hook circuit breaker prevents session crashes from broken hooks (0 session crashes due to hook failures)
- **SC-002**: Git safety validator blocks 100% of force push attempts to protected branches
- **SC-003**: Security scanner detects 90%+ of common secret patterns (AWS, JWT, API keys)
- **SC-004**: Delegation loop detection prevents 100% of infinite loops
- **SC-005**: Max turns enforcement stops runaway conversations within 1 turn of limit
- **SC-006**: Performance monitoring provides latency data accurate to 10ms
- **SC-007**: Conflict detection identifies 100% of concurrent same-file edits

### Quality Attributes

- **Reliability**: Hook system maintains 99.9% uptime even with individual hook failures
- **Performance**: Hook overhead < 50ms per invocation on average
- **Security**: No false negatives for common secret patterns
- **Usability**: Clear error messages with actionable next steps
- **Maintainability**: All new hooks follow existing hook pattern conventions

---

## Technical Constraints (from AGENTS.md)

- **Package Manager**: Bun only (not npm/yarn)
- **Types**: bun-types (not @types/node)
- **Hook Pattern**: `createXXXHook(input: PluginInput)` returning event handlers
- **Hook Location**: `src/hooks/` with dir structure: index.ts, types.ts, constants.ts
- **Existing Hooks**: 21 hooks across 6 categories to integrate with
- **Existing Governance Hooks**: governance-historian, governance-linear-injector, governance-path-validator

---

## Out of Scope

- Agent template standardization (covered in LIF-62 Phase 3)
- Governance injection to agents (covered in LIF-62 Phase 1)
- Multi-layered orchestration design (covered in LIF-62 Phase 2)
- Codebase indexing/semantic search (future enhancement)
- Multi-file edit composer tool (Phase 4 of this issue)

---

## Dependencies

- **LIF-62**: Parent initiative provides architectural context
- **Existing Hook System**: `src/hooks/` infrastructure to extend
- **Existing Governance Hooks**: Integration patterns to follow
- **Background Agent System**: `src/features/background-agent/` for delegation tracking

---

## Assumptions

- Hook circuit breaker threshold of 3 consecutive failures is appropriate (configurable)
- Max turns default of 10 is sufficient for most tasks (configurable)
- Protected branches are `main` and `master` by default (configurable)
- Secret patterns cover AWS, Azure, GCP, JWT, and generic API key formats

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| False positives in secret detection | Medium | Medium | Allowlist mechanism, pattern tuning |
| Performance overhead from new hooks | Low | Medium | Async execution, lazy evaluation |
| Breaking existing hook integrations | Low | High | Thorough testing, incremental rollout |
| Max turns too restrictive | Medium | Low | Configurable limit, clear messaging |

---

## References

- **Parent Issue**: [LIF-62](https://linear.app/lifelogger/issue/LIF-62/multi-layered-agent-orchestration-enhancement-for-oh-my-opencode)
- **Research**: Multi-agent orchestration patterns (Swarm, LangGraph, CrewAI)
- **Research**: Prompt engineering best practices 2025 (Anthropic, DSPy)
- **Research**: Competitor analysis (Cursor, Copilot, Aider, Continue.dev)
- **Existing Hooks**: `src/hooks/index.ts` for current hook registry
- **Hook Pattern**: `src/hooks/comment-checker/` as reference implementation
