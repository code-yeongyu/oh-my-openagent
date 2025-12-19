# Tasks: Multi-Layered Agent Orchestration Enhancement (LIF-62)

**Input**: Design documents from `.cursor/specs/LIF-62-feat-multi-layered-orchestration/`
**Prerequisites**: plan.md (required), spec.md (required for user stories)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story, following the priority defined in the specification.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US6)
- Include exact file paths in descriptions

## Status Conventions

- **Pending**: `- [ ] T123 ...`
- **In progress**: `- [ ] T123 ... (IN PROGRESS)`
- **Blocked**: `- [ ] T123 ... (BLOCKED: <reason>)`
- **Done**: `- [x] T123 ...`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure (from Plan Phase 1)

- [x] T001 [P] Update `src/config/index.ts` to export new modules (governance-template, tool-config)
- [x] T002 Verify TypeScript compilation passes after initial setup (pre-existing errors unrelated to LIF-62)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T003 Add `AgentRole`, `GovernanceLevel`, `ExtendedAgentConfig` types to `src/agents/types.ts`
- [x] T004 Create `src/config/governance-template.ts` with `GOVERNANCE_TEMPLATE_FULL` and `GOVERNANCE_TEMPLATE_MINIMAL`
- [x] T005 Create `src/config/tool-config.ts` with `TOOL_CONFIG_BY_ROLE` mapping
- [x] T006 Add `injectGovernance()` function to `src/agents/utils.ts` for prompt extension

**Checkpoint**: ✅ Foundation ready - user story implementation can now begin.

---

## Phase 3: User Story 1 - Governance-Aware Frontend Implementation (Priority: P1) 🎯 MVP

**Goal**: Ensure `frontend-ui-ux-engineer` follows governance rules (path validation, changelog, Linear).

**Independent Test**: Delegate a UI task to `frontend-ui-ux-engineer` and verify governance hooks fire.

- [x] T007 [US1] Update `src/agents/utils.ts` to inject governance via `AGENT_GOVERNANCE_LEVELS` mapping
- [x] T008 [US1] Test governance injection for `frontend-ui-ux-engineer` by inspecting prompt (verified via code review)
- [ ] T009 [US1] Verify `governance-path-validator` hook fires for `frontend-ui-ux-engineer` writes
- [ ] T010 [US1] Verify `governance-historian` hook creates changelog for `frontend-ui-ux-engineer` sessions

**Checkpoint**: Frontend agent is now governance-aware.

---

## Phase 4: User Story 2 - Multi-Layered Implementation Delegation (Priority: P1) 🎯 MVP

**Goal**: Implement OmO → Implementation Specialist → Specialized Sub-agents chain.

**Independent Test**: Request a full-stack feature and verify the delegation chain completes successfully.

- [ ] T011 [P] [US2] Update `src/tools/call-omo-agent/constants.ts` to expand `ALLOWED_AGENTS`
- [ ] T012 [P] [US2] Update `src/tools/call-omo-agent/tools.ts` to use `getToolConfigForRole()`
- [ ] T013 [P] [US2] Update `src/features/background-agent/manager.ts` to use role-based tool config
- [ ] T014 [US2] Update `src/agents/index.ts` to add role metadata to all existing agents
- [ ] T015 [US2] Create `src/agents/implementation-specialist.ts` (Manager role, Claude Sonnet)
- [ ] T016 [US2] Implement 7-section delegation prompt template in `implementation-specialist.ts`
- [ ] T017 [US2] Register `implementation-specialist` in `src/agents/index.ts`
- [ ] T018 [P] [US2] Create `src/agents/backend-typescript.ts` (Specialist role, Claude Sonnet)
- [ ] T019 [US2] Add backend-specific constraints and patterns to `backend-typescript.ts`
- [ ] T020 [US2] Register `backend-typescript` in `src/agents/index.ts`
- [ ] T021 [P] [US2] Create `src/agents/frontend-react.ts` (Specialist role, Gemini Pro)
- [ ] T022 [US2] Add frontend-specific constraints to `frontend-react.ts`
- [ ] T023 [US2] Register `frontend-react` in `src/agents/index.ts`
- [ ] T024 [US2] Test OmO → Implementation Specialist delegation
- [ ] T025 [US2] Test Implementation Specialist → Backend Specialist delegation
- [ ] T026 [US2] Test Implementation Specialist → Frontend React delegation
- [ ] T027 [US2] Test full chain: OmO → Impl Specialist → Frontend React
- [ ] T028 [US2] Verify depth limit enforcement (specialists cannot use `task` tool)

**Checkpoint**: Multi-layered delegation is functional.

---

## Phase 5: User Story 3 - Centralized Governance Template Injection (Priority: P2)

**Goal**: Define governance once and propagate to all file-modifying agents.

**Independent Test**: Modify `governance-template.ts` and verify changes appear in all governed agents.

- [ ] T029 [US3] Verify governance template propagation to all governed agents without individual file changes
- [ ] T030 [US3] Verify read-only agents (explore, librarian, oracle) are excluded from injection (FR-003)
- [ ] T031 [US3] Verify template includes path validation, changelog, Linear, and spec rules (FR-005)

---

## Phase 6: User Story 4 - Structured Response Formats (Priority: P2)

**Goal**: Predictable handoffs between agents using JSON schemas.

**Independent Test**: Verify specialists return valid JSON metadata alongside markdown explanations.

- [ ] T032 [US4] Add structured response instructions to `implementation-specialist.ts` prompt
- [ ] T033 [P] [US4] Add structured response format instructions to `backend-typescript.ts`
- [ ] T034 [P] [US4] Add structured response format instructions to `frontend-react.ts`
- [ ] T035 [US4] Implement result aggregation logic in `implementation-specialist.ts` (FR-010)
- [ ] T036 [US4] Verify handoff includes structured metadata block AND free-form markdown explanation

---

## Phase 7: User Story 5 - Document Writer Governance Integration (Priority: P3)

**Goal**: Ensure `document-writer` follows governance rules.

**Independent Test**: Delegate a documentation task and verify governance hooks fire.

- [ ] T037 [US5] Update `src/agents/document-writer.ts` to append governance to prompt
- [ ] T038 [US5] Verify `governance-path-validator` hook fires for `document-writer`
- [ ] T039 [US5] Verify `governance-historian` hook creates changelog for `document-writer`

---

## Phase 8: User Story 6 - Complete Workflow Visualization (Priority: P3)

**Goal**: Document the orchestration flow for maintenance and debugging.

**Independent Test**: Review documentation and trace a sample task through all stages.

- [ ] T040 [P] [US6] Create workflow documentation in `docs/architecture/02-agent-system.md` (or new file)
- [ ] T041 [P] [US6] Update root `README.md` with new agent documentation and hierarchy map

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final integration and constitution alignment

- [ ] T042 Test full delegation chain: OmO → Impl Specialist → Backend/Frontend with Linear context
- [ ] T043 Verify `governance-linear-injector` fires at all levels of the delegation chain
- [ ] T044 Update OmO prompt (`src/agents/omo.ts`) to explicitly reference `implementation-specialist` for complex tasks
- [ ] T045 Update `.cursor/memory/constitution.md` with the Multi-Variant Architecture vision

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Phase 1. BLOCKS all user stories.
- **User Stories (Phase 3-7)**: All depend on Phase 2.
  - US1 and US2 (P1) should be prioritized.
  - US3 and US4 (P2) can proceed after P1 foundation is stable.
  - US5 and US6 (P3) are final additions.
- **Polish (Phase 9)**: Depends on all user stories being complete.

### Parallel Opportunities

- T001, T003-T005 can be drafted in parallel.
- US1 (T007-T010) and US5 (T037-T039) are identical patterns for different agents.
- Specialist agents (T018-T023) can be developed in parallel once `implementation-specialist` (T015) is defined.
- Documentation tasks (T040-T041) can run in parallel with implementation.
