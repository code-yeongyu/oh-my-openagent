# Feature Specification: Command Workflow Harmonization

**Feature ID**: `LIF-65-feat-command-workflow-harmonization`  
**Created**: 2025-12-18  
**Status**: Draft  
**Linear Issue**: [LIF-65](https://linear.app/lifelogger/issue/LIF-65)  
**Branch**: `hello/lif-65-command-workflow-harmonization-unified-contract-governance`

## Executive Summary

Unify all 35+ commands under a shared workflow contract with consistent Linear integration, governance tool usage, persisted workflow state, and quality workflow commands. This addresses fundamental gaps where commands were created at different times with varying patterns, resulting in inconsistent user experience and broken handoffs.

## Problem Statement

Deep analysis revealed critical gaps in the command ecosystem:

| Gap | Impact |
|-----|--------|
| **Linear Integration Chaos** | `/specify` requires Linear, `/tasks` asks user, `/plan` + `/implement` ignore it |
| **Governance Tools Unused** | `linear-branch`, `linear-update-status`, `read-context` exist but NO commands call them |
| **Quality Workflow Missing** | Agents exist (code-reviewer, test-engineer) but no `/review`, `/test` commands |
| **No Session State** | User returns later, context lost, no resume capability |
| **Spec Awareness Inconsistent** | Core workflow uses spec folders, review/debug commands don't |

## User Scenarios & Testing

### User Story 1 - Unified Linear Policy (Priority: P0)

As a developer, I want consistent Linear integration across all commands so that I don't have to remember different behaviors for each command.

**Why this priority**: Linear inconsistency is the most jarring UX issue - users are confused when `/specify` requires Linear but `/plan` ignores it.

**Independent Test**: Run `/specify`, `/plan`, `/tasks`, `/implement` in sequence and verify Linear status updates at each step.

**Acceptance Scenarios**:

1. **Given** Linear MCP is configured, **When** I run any workflow command, **Then** it follows the project's Linear policy (off/optional/required)
2. **Given** Linear policy is `optional`, **When** I run `/plan` without a Linear issue, **Then** it prompts me once to create one but proceeds if I decline
3. **Given** Linear policy is `required`, **When** I run `/implement` without a Linear issue, **Then** it blocks and explains how to create one

---

### User Story 2 - Shared WorkflowContext (Priority: P0)

As a developer, I want commands to share context so that I don't have to re-specify the same information across `/specify`, `/plan`, `/tasks`, and `/implement`.

**Why this priority**: Context sharing is foundational - without it, every other improvement is fragmented.

**Independent Test**: Run `/specify` with a feature description, then run `/plan` without arguments - it should find and use the spec folder automatically.

**Acceptance Scenarios**:

1. **Given** I ran `/specify` for feature X, **When** I run `/plan`, **Then** it auto-detects the spec folder and uses it
2. **Given** I'm on branch `hello/lif-65-feature`, **When** I run `/tasks`, **Then** it finds `.cursor/specs/LIF-65-*/` automatically
3. **Given** multiple spec folders exist, **When** I run `/implement`, **Then** it prompts me to select or uses the one matching current branch

---

### User Story 3 - commandPreflight() Validation (Priority: P0)

As a developer, I want commands to validate prerequisites before running so that I don't waste time on commands that will fail mid-execution.

**Why this priority**: Without preflight validation, users run `/plan` without `/specify`, get confusing errors mid-way.

**Independent Test**: Run `/plan` without running `/specify` first - should get clear error with recovery action.

**Acceptance Scenarios**:

1. **Given** no `spec.md` exists, **When** I run `/plan`, **Then** it says "spec.md not found. Run `/specify` first or create manually."
2. **Given** `spec.md` exists but `plan.md` doesn't, **When** I run `/tasks`, **Then** it says "plan.md not found. Run `/plan` first."
3. **Given** all prerequisites exist, **When** I run `/implement`, **Then** it proceeds without prompts

---

### User Story 4 - Quality Workflow Commands (Priority: P0)

As a developer, I want `/review` and `/test` commands so that the quality workflow has explicit entry points like the planning workflow does.

**Why this priority**: `/implement` handoffs reference code-reviewer and test-engineer agents but there's no command to invoke them.

**Independent Test**: After running `/implement`, run `/review` and verify it uses spec folder context.

**Acceptance Scenarios**:

1. **Given** implementation is complete, **When** I run `/review`, **Then** it invokes code-reviewer with spec folder context
2. **Given** implementation is complete, **When** I run `/test`, **Then** it invokes test-engineer with spec folder context
3. **Given** spec folder has `spec.md`, **When** I run `/review`, **Then** review validates against original requirements

---

### User Story 5 - Persisted Workflow State (Priority: P1)

As a developer, I want workflow state persisted so that I can resume work after closing my session.

**Why this priority**: Session continuity enables multi-day features without losing context.

**Independent Test**: Run `/specify` + `/plan`, close session, reopen, run `/tasks` - should resume from correct state.

**Acceptance Scenarios**:

1. **Given** I completed `/specify` yesterday, **When** I run `/plan` today, **Then** it finds the spec folder and continues
2. **Given** `tasks.md` shows 3/5 tasks complete, **When** I run `/implement`, **Then** it starts from task 4
3. **Given** workflow state exists, **When** I run any command, **Then** it shows "Resuming from: [last step]"

---

### User Story 6 - Command Discoverability (Priority: P1)

As a developer, I want organized `/help` so that I can find the right command without memorizing 35+ options.

**Why this priority**: 35+ commands is overwhelming - users don't know `/specify` exists or when to use it.

**Independent Test**: Run `/help` and verify core workflow commands are prominently displayed.

**Acceptance Scenarios**:

1. **Given** I run `/help`, **Then** I see 8-12 core commands with the workflow chain highlighted
2. **Given** I run `/help workflow`, **Then** I see the full `/specify → /plan → /tasks → /implement → /review` chain
3. **Given** I run an unknown command, **Then** it suggests similar commands ("Did you mean /specify?")

---

### User Story 7 - Governance Tool Integration (Priority: P1)

As a developer, I want commands to automatically call governance tools so that Linear status is always current and audit trails are maintained.

**Why this priority**: Governance tools exist but are never called - this makes them actually useful.

**Independent Test**: Run `/implement`, check Linear issue is updated to "In Progress" automatically.

**Acceptance Scenarios**:

1. **Given** I run `/implement` on LIF-65, **When** implementation starts, **Then** `linear-update-status(in_progress)` is called
2. **Given** I complete `/implement`, **When** I mark done, **Then** `linear-update-status(done)` is called with summary
3. **Given** I run any command, **When** it writes files, **Then** paths are validated via governance hooks

---

### Edge Cases

- What happens when Linear MCP is unavailable mid-session? → Graceful degradation, local-only mode
- What happens when `tasks.md` and runtime todos conflict? → Prompt with 3-way choice (prefer tasks.md, prefer todos, merge)
- What happens when branch doesn't match spec folder? → Warning with option to switch or proceed

## Requirements

### Functional Requirements

#### WorkflowContext (FR-1xx)

- **FR-101**: System MUST provide a shared `WorkflowContext` object accessible to all commands
- **FR-102**: WorkflowContext MUST include: `specPath`, `linearIssueId`, `branchName`, `policy`, `runId`
- **FR-103**: Context resolution MUST follow priority: CLI args → spec folder metadata → branch parsing → user prompt
- **FR-104**: System MUST persist WorkflowContext to `{SPEC_DIR}/workflow-state.json`

#### commandPreflight (FR-2xx)

- **FR-201**: All workflow commands MUST call `commandPreflight()` before execution
- **FR-202**: Preflight MUST validate required artifacts exist (spec.md for /plan, plan.md for /tasks, etc.)
- **FR-203**: Preflight MUST call `read-context` to load project configuration
- **FR-204**: Preflight MUST check/create spec folder when requested
- **FR-205**: Preflight MUST call governance tools (`linear-update-status`) when Linear is available
- **FR-206**: Preflight MUST return `{ok|blocked, fixes:[...]}` with explicit next actions

#### Linear Policy (FR-3xx)

- **FR-301**: System MUST support Linear policy modes: `off`, `optional`, `required`
- **FR-302**: Policy MUST be configurable in `project-context.yaml` or environment variable
- **FR-303**: Default policy MUST be `optional` (prompt but don't block)
- **FR-304**: `required` mode MUST block commands without Linear issue
- **FR-305**: `off` mode MUST skip all Linear integration silently

#### Quality Commands (FR-4xx)

- **FR-401**: System MUST provide `/review` command that invokes code-reviewer agent
- **FR-402**: System MUST provide `/test` command that invokes test-engineer agent
- **FR-403**: Quality commands MUST read spec folder artifacts for context
- **FR-404**: Quality commands MUST write results to spec folder (`reviews/`, `testing/`)
- **FR-405**: Quality commands MUST update `status.md` with completion

#### Workflow State (FR-5xx)

- **FR-501**: System MUST persist workflow state to `{SPEC_DIR}/workflow-state.json`
- **FR-502**: State MUST include: `currentStep`, `completedSteps`, `artifactHashes`, `linearIssueId`, `updatedAt`
- **FR-503**: Commands MUST read state on start and update on completion
- **FR-504**: System MUST detect drift between `tasks.md` and state, prompt for resolution

#### Command Discoverability (FR-6xx)

- **FR-601**: `/help` MUST show grouped commands by category (Workflow, Quality, Utility, etc.)
- **FR-602**: `/help` MUST highlight the core workflow chain prominently
- **FR-603**: Unknown command MUST suggest similar alternatives
- **FR-604**: Commands MUST include `workflow_next` frontmatter for next-step hints

### Key Entities

- **WorkflowContext**: Shared context object passed between commands
- **WorkflowState**: Persisted state file tracking progress
- **LinearPolicy**: Configuration determining Linear integration behavior
- **CommandPreflight**: Validation function run before each command

## Success Criteria

### Measurable Outcomes

- **SC-001**: All workflow commands use shared WorkflowContext (100% adoption)
- **SC-002**: Linear integration follows single policy across all commands (no per-command variance)
- **SC-003**: `/review` and `/test` commands exist and integrate with spec folders
- **SC-004**: Workflow state survives session restart (can resume from any point)
- **SC-005**: `/help` shows organized categories with workflow chain visible
- **SC-006**: Governance tools (`linear-update-status`, `read-context`) are called by commands
- **SC-007**: Zero "phantom" command references in agent prompts (all referenced commands exist)

## Out of Scope

- Retrofitting ALL legacy commands (P2, incremental)
- `/docs` and `/deploy` commands (defer until demand)
- Bidirectional `tasks.md` ↔ Linear sync (complex, defer)
- Command caching/performance optimization (P3)

## Dependencies

- Linear MCP must be configured for Linear integration
- `.cursor/specs/` folder structure must exist
- Governance hooks must be enabled
- Project must use oh-my-opencode plugin

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing workflows | Medium | High | Compatibility shim for legacy commands |
| Over-enforcement blocks users | Medium | Medium | Default to `optional` policy, gentle prompts |
| State file corruption | Low | Medium | Backup artifacts, atomic writes |
| Context resolution conflicts | Medium | Low | Clear priority order, explicit prompts |

## Technical Notes

### Implementation Phases

1. **Phase 1**: Shared `WorkflowContext` + `commandPreflight()` (foundation)
2. **Phase 2**: Update `/specify` + `/tasks` to use new contract (prove pattern)
3. **Phase 3**: Add `/review` + `/test` commands
4. **Phase 4**: Add workflow state persistence
5. **Phase 5**: Update `/help` with grouping and discovery
6. **Phase 6**: Retrofit remaining commands (incremental)

### Files to Create/Modify

**New Files**:
- `.opencode/command/review.md` - Code review command
- `.opencode/command/test.md` - Testing command
- `src/shared/workflow-context.ts` - WorkflowContext implementation
- `src/shared/command-preflight.ts` - Preflight validation

**Modified Files**:
- `.opencode/command/specify.md` - Use commandPreflight
- `.opencode/command/plan.md` - Use commandPreflight
- `.opencode/command/tasks.md` - Use commandPreflight
- `.opencode/command/implement.md` - Use commandPreflight
- `src/tools/slashcommand/tools.ts` - Add help grouping

## Handoffs

- **Next Phase**: `/plan` - Create technical architecture for WorkflowContext
- **Clarification**: `/clarify` - If requirements need refinement
- **Implementation**: After `/plan` and `/tasks`, proceed to `/implement`

## References

- Analysis Session: Deep analysis of 35+ commands (2025-12-18)
- Oracle Consultation: Architecture recommendations (3 oracles consulted)
- Research: Spec-driven development best practices, agentic workflow patterns
- Constitution: `.cursor/memory/constitution.md`
- Architecture: `.cursor/memory/architecture.md`
