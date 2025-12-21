# Tasks: LIF-69 OmO Delegation Optimization

**Linear Issue**: [LIF-69](https://linear.app/lifelogger/issue/LIF-69/omo-delegation-optimization-cost-reduction-and-enforcement)
**Branch**: `hello/lif-69-omo-delegation-optimization-cost-reduction-enforcement`
**Input**: Design documents from `.cursor/specs/LIF-69-feat-omo-delegation-optimization/`
**Prerequisites**: plan.md ✅, spec.md ✅

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US6)
- Include exact file paths in descriptions

## Status Conventions

- **Pending**: `- [ ] T### ...`
- **In progress**: `- [ ] T### ... (IN PROGRESS)`
- **Blocked**: `- [ ] T### ... (BLOCKED: <reason>)`
- **Done**: `- [x] T### ...`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Artifact contract types and shared utilities - foundation for all features

**Effort**: 1-2 hours

- [x] T001 [P] Create `src/shared/artifact-response.ts` with `ArtifactResponse`, `ArtifactStatus`, `ArtifactPointer`, `ArtifactTelemetry` interfaces
- [x] T002 [P] Create `src/shared/delegation-policy.ts` with `DelegationPolicy`, `DelegationPolicyRule`, `PolicyMode`, `PolicyDecision` interfaces
- [x] T003 Export new modules from `src/shared/index.ts`
- [x] T004 Add feature flags to `src/config/schema.ts`: `docsBlockingGate`, `artifactTruncation`, `delegationCompliance`

**Checkpoint**: Types compile, schema validates with new flags

---

## Phase 2: Foundational (P0 - Blocking Prerequisites)

**Purpose**: Core enforcement infrastructure that MUST be complete before user story validation

**⚠️ CRITICAL**: No user story acceptance testing possible until this phase is complete

**Effort**: 2-4 hours

### P0.1: Artifact Truncation Utilities

- [x] T005 Implement `coerceToArtifactResponse()` in `src/shared/artifact-response.ts` - wrap raw text into envelope
- [x] T006 Implement `truncateArtifactResponse()` in `src/shared/artifact-response.ts` - enforce ≤200 token-estimate summary
- [x] T007 Implement `formatArtifactResponseForReturn()` in `src/shared/artifact-response.ts` - stringify with task metadata
- [x] T008 Add `ArtifactTruncationConfig` interface with `maxSummaryTokenEstimate`, `maxOutputChars`, `keepTaskMetadata`

### P0.2: Tool Boundary Enforcement

- [x] T009 Modify `src/tools/call-omo-agent/tools.ts` - import artifact utilities
- [x] T010 Modify `executeSync()` in `src/tools/call-omo-agent/tools.ts` - build artifact envelope from `responseText`
- [x] T011 Modify `executeSync()` in `src/tools/call-omo-agent/tools.ts` - apply truncation before return
- [x] T012 Preserve `<task_metadata>` block outside summary budget in truncation logic
- [x] T013 Add telemetry fields (`inputChars`, `outputChars`, `truncated`) to artifact response

### P0.3: Documentation BLOCKING Gate Hook

- [x] T014 [P] Create `src/hooks/governance-docs-delegation/types.ts` with hook config types
- [x] T015 [P] Create `src/hooks/governance-docs-delegation/constants.ts` with doc path patterns: `docs/**`, `**/*.md`, `README*`, `CHANGELOG*`
- [x] T016 Create `src/hooks/governance-docs-delegation/index.ts` - hook on `tool.execute.before` for `write`/`edit`
- [x] T017 Implement path matching logic using glob patterns from constants
- [x] T018 Implement actor-aware exceptions: allow `document-writer` agent to bypass blocking
- [x] T019 Implement remediation message with delegation instructions when blocked
- [x] T020 Export hook from `src/hooks/index.ts`
- [x] T021 Register hook conditionally in `src/index.ts` based on config flag

**Checkpoint**: Foundation ready
- `bun run typecheck` passes
- `bun run build` succeeds
- Artifact truncation works in isolation
- Docs blocking activates on README.md edits

---

## Phase 3: User Story 1 - Cost-Conscious Developer (Priority: P1) 🎯 MVP

**Goal**: Developers see reduced Opus token usage through artifact-based returns

**Independent Test**: Delegate to implementation-specialist, verify returned content is ≤200 tokens regardless of specialist output size

**Spec Reference**: US-001

### Implementation for User Story 1

- [x] T022 [US1] Verify artifact envelope includes `status`, `summary`, `filesChanged`, `warnings`, `nextSteps`
- [x] T023 [US1] Verify truncation kicks in for outputs >800 chars (200 tokens × 4 chars)
- [x] T024 [US1] Ensure `telemetry.truncated=true` flag is set when truncation occurs
- [x] T025 [US1] Test with verbose subagent output (simulate 10K token response)
- [x] T026 [US1] Verify OmO can read artifact files to verify completion (file paths in response)

**Checkpoint**: US-001 acceptance scenarios pass
- Specialist output truncated to ≤200 tokens
- File paths included for verification
- Full output NOT returned through OmO

---

## Phase 4: User Story 2 - Documentation Task Delegation (Priority: P1) 🎯 MVP

**Goal**: Documentation tasks automatically blocked unless delegated to document-writer

**Independent Test**: Attempt direct edit to `README.md` as OmO, verify BLOCKED with remediation message

**Spec Reference**: US-002

### Implementation for User Story 2

- [x] T027 [US2] Verify BLOCKING triggers on file path match (docs/*, *.md, README*)
- [x] T028 [US2] Verify remediation message includes "delegate to document-writer" instruction
- [x] T029 [US2] Verify document-writer agent can edit docs files without blocking
- [x] T030 [US2] Test mixed task scenario: code change allowed, docs change blocked
- [ ] T031 [US2] Implement user override detection for explicit "OmO write docs" requests (P1)
- [ ] T032 [US2] Add cost acknowledgment prompt when user overrides delegation (P1)

**Checkpoint**: US-002 acceptance scenarios pass
- Direct docs edits blocked for non-document-writer agents
- Remediation message is actionable
- Mixed tasks split correctly

---

## Phase 5: User Story 3 - Delegation Compliance Monitoring (Priority: P2)

**Goal**: Runtime enforcement with violation tracking and escalation

**Independent Test**: Trigger 3 blocked attempts, verify escalation from warn to hard block

**Spec Reference**: US-003

### Implementation for User Story 3

- [ ] T033 [P] [US3] Create `src/hooks/delegation-compliance/types.ts` with session violation tracking types
- [ ] T034 [P] [US3] Create `src/hooks/delegation-compliance/constants.ts` with escalation thresholds
- [ ] T035 [US3] Create `src/hooks/delegation-compliance/index.ts` - monitor tool calls for policy violations
- [ ] T036 [US3] Implement session-scoped violation counter: `Map<sessionId, Record<ruleId, count>>`
- [ ] T037 [US3] Implement escalation logic: warn→block after `strikesToBlock` violations
- [ ] T038 [US3] Emit structured log per policy decision (include trace_id)
- [ ] T039 [US3] Export hook from `src/hooks/index.ts`
- [ ] T040 [US3] Register hook conditionally in `src/index.ts`

**Checkpoint**: US-003 acceptance scenarios pass
- Violations tracked per session
- Escalation from warn to block works
- Logs include trace_id for debugging

---

## Phase 6: User Story 4 - Delegate-First Identity (Priority: P2)

**Goal**: OmO defaults to delegation rather than self-execution

**Independent Test**: Send non-trivial docs request, verify OmO delegates without prompting

**Spec Reference**: US-004

### Implementation for User Story 4

- [ ] T041 [US4] Modify `src/agents/omo.ts` - rewrite identity line from "work, delegate" to "delegate, verify"
- [ ] T042 [US4] Add explicit classification step in OmO prompt: "classify intent → choose specialist → delegate"
- [ ] T043 [US4] Add hard directive: "documentation MUST be delegated to document-writer"
- [ ] T044 [US4] Add TRIVIAL bypass clause: "only execute directly for single-file reads and trivial queries"
- [ ] T045 [US4] Test that non-trivial docs requests trigger delegation by default

**Checkpoint**: US-004 acceptance scenarios pass
- OmO classifies tasks before acting
- Documentation requests trigger delegation
- Trivial tasks remain direct

---

## Phase 7: User Story 5 - Domain Module Injection (Priority: P3) 🔮 Future

**Goal**: Specialists receive domain-specific context without OmO prompt bloat

**Independent Test**: Delegate to implementation-specialist, verify code domain module is injected

**Spec Reference**: US-005

### Implementation for User Story 5

- [ ] T046 [P] [US5] Create `src/features/orchestration/domain-module-loader.ts` with lazy loading
- [ ] T047 [US5] Implement `DomainModule` interface with `render()` method
- [ ] T048 [US5] Create built-in modules: `code`, `docs`, `finance`, `pm`
- [ ] T049 [US5] Implement detection logic using keywords and path prefixes
- [ ] T050 [US5] Enforce `maxChars` cap on module injection (deterministic)
- [ ] T051 [US5] Inject module in `call_omo_agent` when building delegation prompt
- [ ] T052 [US5] Cache modules per session to avoid repeated rendering

**Checkpoint**: US-005 acceptance scenarios pass
- Code domain module loads for implementation tasks
- Module injection ≤500 tokens
- No module for generic tasks

---

## Phase 8: User Story 6 - Risk-Based Model Routing (Priority: P3) 🔮 Future

**Goal**: High-risk tasks route to Opus, low-risk to cheaper models

**Independent Test**: Send auth-related task, verify HIGH risk classification

**Spec Reference**: US-006

### Implementation for User Story 6

- [ ] T053 [P] [US6] Create `src/features/orchestration/model-router.ts` with router logic
- [ ] T054 [US6] Implement `ModelRouterConfig` with risk tiers and rules
- [ ] T055 [US6] Implement rule evaluation in priority order
- [ ] T056 [US6] Implement sensitive path escalation: `auth/`, `security/`, `payment/`
- [ ] T057 [US6] Integrate router in `call_omo_agent` at delegation decision time
- [ ] T058 [US6] Implement user override with cost acknowledgment logging
- [ ] T059 [US6] Add guardrails: deny downgrades for high-risk intents

**Checkpoint**: US-006 acceptance scenarios pass
- High-risk → Opus routing
- Low-risk → cheaper model routing
- Sensitive paths trigger escalation

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Finalization, documentation, and cleanup

**Effort**: 1-2 hours

- [ ] T060 [P] Update `src/hooks/index.ts` with all new hook exports
- [ ] T061 [P] Update `src/features/orchestration/index.ts` with new feature exports
- [ ] T062 Run `bun run typecheck` and fix any remaining type errors
- [ ] T063 Run `bun run build` and verify clean build
- [ ] T064 Update `.cursor/specs/LIF-69-feat-omo-delegation-optimization/status.md` to Done
- [ ] T065 Create changelog entry documenting all changes

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup) ──┐
                  ├──► Phase 2 (Foundational P0) ──┬──► Phase 3 (US-001)
                  │                                ├──► Phase 4 (US-002)
                  │                                ├──► Phase 5 (US-003)
                  │                                └──► Phase 6 (US-004)
                  │
                  └──────────────────────────────────► Phase 7 (US-005 P2)
                                                   └──► Phase 8 (US-006 P2)
                                                   
All ──► Phase 9 (Polish)
```

### Priority Order (if sequential)

1. **P0 (Critical)**: Phase 1 → Phase 2 → Phase 3 → Phase 4
2. **P1 (High)**: Phase 5 → Phase 6
3. **P2 (Medium)**: Phase 7 → Phase 8
4. **Final**: Phase 9

### Parallel Opportunities

- T001, T002 can run in parallel (different files)
- T014, T015 can run in parallel (different files)
- T033, T034 can run in parallel (different files)
- T046, T053 can run in parallel (different features)
- All Phase 9 tasks marked [P] can run in parallel

### Effort Estimates by Phase

| Phase | Tasks | Effort | Priority |
|-------|-------|--------|----------|
| 1 - Setup | T001-T004 | 1h | P0 |
| 2 - Foundational | T005-T021 | 2-4h | P0 |
| 3 - US-001 | T022-T026 | 1h | P0 |
| 4 - US-002 | T027-T032 | 1h | P0 |
| 5 - US-003 | T033-T040 | 2h | P1 |
| 6 - US-004 | T041-T045 | 30min | P1 |
| 7 - US-005 | T046-T052 | 2-3h | P2 |
| 8 - US-006 | T053-T059 | 2-3h | P2 |
| 9 - Polish | T060-T065 | 1h | Final |

**Total**: ~13-17 hours (3-4 days)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- P2 phases (7, 8) are optional - can be deferred to future iteration
