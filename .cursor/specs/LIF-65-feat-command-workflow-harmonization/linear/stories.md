# Stories: LIF-65 Children

**Parent**: LIF-65  
**Action**: CREATE as child issues under LIF-65

---

## Story 1: Foundation Infrastructure

**Title**: Create WorkflowContext and commandPreflight

As a command developer, I want shared context resolution so commands don't duplicate logic.

### Acceptance Criteria

- [ ] WorkflowContext type with specPath, linearIssueId, branchName, policy
- [ ] commandPreflight() validates artifacts and resolves context
- [ ] Linear policy configurable (off|optional|required)
- [ ] Exported from src/shared/

**Estimate**: 5 points  
**Labels**: `type:feature`

---

## Story 2: Workflow Command Updates

**Title**: Update /specify, /plan, /tasks, /implement with preflight

As a developer, I want workflow commands to auto-detect context so I don't re-specify info.

### Acceptance Criteria

- [ ] /specify uses commandPreflight, creates spec folder
- [ ] /plan requires spec.md, updates Linear status
- [ ] /tasks requires plan.md, spec.md
- [ ] /implement requires tasks.md

**Estimate**: 3 points  
**Labels**: `type:feature`

---

## Story 3: Quality Workflow Commands

**Title**: Add /review and /test commands

As a developer, I want quality commands so code review and testing have explicit entry points.

### Acceptance Criteria

- [ ] /review delegates to code-reviewer with spec context
- [ ] /test delegates to test-engineer with spec context
- [ ] Both read spec.md for requirements context

**Estimate**: 2 points  
**Labels**: `type:feature`

---

## Story 4: Workflow State Persistence

**Title**: Persist workflow state for session continuity

As a developer, I want workflow state saved so I can resume after closing session.

### Acceptance Criteria

- [ ] workflow-state.json created in spec folder
- [ ] Commands show "Resuming from: [step]"
- [ ] Artifact hashes detect drift

**Estimate**: 2 points  
**Labels**: `type:feature`

---

## Story 5: Command Discoverability

**Title**: Improve /help with categories and workflow chain

As a developer, I want organized /help so I can find commands without memorizing 35+ options.

### Acceptance Criteria

- [ ] /help shows categories (Workflow, Quality, Utility)
- [ ] /help workflow shows full chain
- [ ] Unknown command suggests similar

**Estimate**: 2 points  
**Labels**: `type:feature`
