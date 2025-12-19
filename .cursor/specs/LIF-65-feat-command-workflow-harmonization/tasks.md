# Tasks: Command Workflow Harmonization

**Input**: `.cursor/specs/LIF-65-feat-command-workflow-harmonization/`  
**Prerequisites**: spec.md ✅, plan.md ✅

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel
- **[Story]**: US1-US7 (from spec.md)

## Status Conventions

- **Pending**: `- [ ] T### ...`
- **In progress**: `- [ ] T### ... (IN PROGRESS)`
- **Done**: `- [x] T### ...`

---

## Phase 1: Foundation (Blocking Prerequisites)

**Purpose**: Core infrastructure - WorkflowContext + commandPreflight. BLOCKS all user stories.

- [x] T001 [US2] Create `src/shared/workflow-context.ts` - WorkflowContext type, LinearPolicy type, ContextSource type
- [x] T002 [P] [US2] Add context resolution logic - branch parsing, spec folder detection, CLI args priority
- [x] T003 [US3] Create `src/shared/command-preflight.ts` - PreflightOptions, PreflightResult, PreflightIssue, PreflightFix types
- [x] T004 [P] [US3] Implement preflight validation - artifact existence checks, governance tool calls
- [x] T005 [P] [US1] Add Linear policy config to `src/config/schema.ts` - off|optional|required enum
- [x] T006 [US1] Add policy resolution in preflight - env var, project-context.yaml, default=optional
- [x] T007 Export from `src/shared/index.ts` - workflow-context, command-preflight

**Checkpoint**: Foundation ready - preflight can validate any command

---

## Phase 2: User Story 2 + 3 - Prove Pattern (P0)

**Goal**: Update `/specify` and `/tasks` to use commandPreflight, proving the pattern works.

**Independent Test**: Run `/specify test feature` → `/plan` → `/tasks`, verify context auto-detected.

### Implementation

- [x] T008 [US2] [US3] Add workflow frontmatter to `.opencode/command/specify.md` - step, requires, produces, next
- [x] T009 [US2] [US3] Add preflight instructions to specify.md prompt - call commandPreflight, handle blocked
- [x] T010 [US2] [US3] Add workflow frontmatter to `.opencode/command/tasks.md`
- [x] T011 [US2] [US3] Add preflight instructions to tasks.md prompt - require plan.md, spec.md

**Checkpoint**: `/specify` → `/plan` → `/tasks` flow uses shared context

---

## Phase 3: User Story 1 + 7 - Linear Integration (P0)

**Goal**: Consistent Linear policy enforcement and governance tool usage.

**Independent Test**: Run `/implement` on LIF-65, verify Linear status updated automatically.

### Implementation

- [ ] T012 [US1] Add Linear policy check to preflight - block if required + missing, prompt if optional
- [ ] T013 [US7] Add `linear-update-status` call to preflight - auto-update on command start
- [ ] T014 [US7] Add `read-context` call to preflight - load project config
- [x] T015 [P] [US1] Update `.opencode/command/plan.md` - add workflow frontmatter, use preflight
- [x] T016 [P] [US1] Update `.opencode/command/implement.md` - add workflow frontmatter, use preflight

**Checkpoint**: All core workflow commands follow Linear policy

---

## Phase 4: User Story 4 - Quality Commands (P0)

**Goal**: Add `/review` and `/test` commands delegating to existing agents.

**Independent Test**: After `/implement`, run `/review` - should find spec folder and invoke code-reviewer.

### Implementation

- [x] T017 [P] [US4] Create `.opencode/command/review.md` - delegate to code-reviewer agent, spec folder aware
- [x] T018 [P] [US4] Create `.opencode/command/test.md` - delegate to test-engineer agent, spec folder aware
- [ ] T019 [US4] Add workflow frontmatter to review.md - step=review, requires=[implementation], produces=[reviews/]
- [ ] T020 [US4] Add workflow frontmatter to test.md - step=test, requires=[implementation], produces=[testing/]

**Checkpoint**: Quality workflow has explicit entry points

---

## Phase 5: User Story 5 - Workflow State (P1) ✅

**Goal**: Persist workflow state for session continuity.

**Independent Test**: Run `/specify` + `/plan`, close session, reopen, run `/tasks` - should resume.

### Implementation

- [x] T021 [US5] Create WorkflowState type in workflow-context.ts - currentStep, completedSteps, artifactHashes
- [x] T022 [US5] Add state persistence to preflight - write `workflow-state.json` after command
- [x] T023 [US5] Add state reading to preflight - show "Resuming from: [step]" message
- [x] T024 [US5] Add artifact hash tracking - detect drift between tasks.md and state

**Checkpoint**: Workflow survives session restart ✅

---

## Phase 6: User Story 6 - Command Discoverability (P1) ✅

**Goal**: Improve `/help` with categories and workflow chain visibility.

**Independent Test**: Run `/help` - should show grouped commands with workflow chain highlighted.

### Implementation

- [x] T025 [P] [US6] Add `category` and `primary` frontmatter to all workflow commands
- [x] T026 [US6] Modify `src/tools/slashcommand/tools.ts` - group commands by category in help output
- [x] T027 [US6] Implement `/help workflow` subcommand - show full workflow chain
- [x] T028 [US6] Add unknown command suggestions - fuzzy match similar commands

**Checkpoint**: Users can discover and navigate commands easily ✅

---

## Phase 7: Polish & Documentation ✅

**Purpose**: Final cleanup and documentation.

- [x] T029 [P] Update project-context.yaml example with linear.policy
- [x] T030 [P] Add JSDoc comments to workflow-context.ts and command-preflight.ts
- [x] T031 Update status.md with feature completion

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1** (Foundation): No dependencies - start here
- **Phase 2** (Prove Pattern): Depends on Phase 1
- **Phase 3** (Linear Integration): Depends on Phase 1
- **Phase 4** (Quality Commands): Depends on Phase 1
- **Phase 5** (Workflow State): Depends on Phase 1-2
- **Phase 6** (Discoverability): Depends on Phase 1
- **Phase 7** (Polish): Depends on all above

### Parallel Opportunities

After Phase 1 complete:
- Phase 2, 3, 4, 6 can run in parallel (different files)
- Phase 5 depends on Phase 2 patterns

Within phases:
- Tasks marked [P] can run in parallel
- T001-T007 should be sequential (foundation building)

### User Story Mapping

| User Story | Primary Phase | Tasks |
|------------|---------------|-------|
| US1: Linear Policy | Phase 1, 3 | T005, T006, T012, T015, T016 |
| US2: WorkflowContext | Phase 1, 2 | T001, T002, T008, T009, T010, T011 |
| US3: commandPreflight | Phase 1, 2 | T003, T004, T008, T009, T010, T011 |
| US4: Quality Commands | Phase 4 | T017, T018, T019, T020 |
| US5: Workflow State | Phase 5 | T021, T022, T023, T024 |
| US6: Discoverability | Phase 6 | T025, T026, T027, T028 |
| US7: Governance Tools | Phase 3 | T013, T014 |

---

## Estimates

| Phase | Tasks | Estimate | Priority |
|-------|-------|----------|----------|
| Phase 1 | T001-T007 | 4h | P0 |
| Phase 2 | T008-T011 | 2h | P0 |
| Phase 3 | T012-T016 | 2h | P0 |
| Phase 4 | T017-T020 | 2h | P0 |
| Phase 5 | T021-T024 | 2h | P1 |
| Phase 6 | T025-T028 | 2h | P1 |
| Phase 7 | T029-T031 | 1h | P2 |
| **Total** | 31 tasks | **15h** | |

---

## Notes

- Tests not included (no test framework configured per AGENTS.md)
- Verification via dogfooding (use commands to build LIF-65)
- Backward compatible - preflight is additive
- Default Linear policy: `optional` (prompt but don't block)
