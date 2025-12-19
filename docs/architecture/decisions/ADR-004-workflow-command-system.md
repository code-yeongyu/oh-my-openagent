---
title: "ADR-004: Workflow Command System"
description: "Architecture decision record for the spec-driven workflow system with preflight validation and state persistence"
status: "accepted"
date: "2025-12-18"
---

# ADR-004: Workflow Command System

## Status

**Accepted** (LIF-65, LIF-67)

## Context

Feature development in OhMyOpenCode involves multiple workflow steps (specify, plan, tasks, implement, review, test). Without proper orchestration:

1. **Broken Workflows**: Agents run `/plan` before `/specify`, missing prerequisites
2. **Lost Context**: Session restarts lose progress; agents don't know what's been completed
3. **No Continuity**: Can't resume work mid-workflow after interruptions
4. **Poor Organization**: Commands scattered, no clear progression

### Options Considered

1. **Manual Coordination**: Rely on agents to check prerequisites themselves
2. **Hardcoded Checks**: Each command validates prerequisites independently
3. **Centralized Preflight + State Management**: Single validation system with persistent state
4. **External Workflow Engine**: Separate service orchestrates workflow steps

## Decision

We chose **Centralized Preflight + State Management** integrated into the slashcommand tool.

### Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                    Workflow Command Execution                  │
│                                                                │
│  User invokes: /plan                                          │
│         │                                                      │
│         ▼                                                      │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │           Slashcommand Tool                             │  │
│  │  ┌─────────────────────────────────────────────────┐    │  │
│  │  │ 1. Load command metadata (frontmatter)          │    │  │
│  │  │    - step: "plan"                               │    │  │
│  │  │    - requires: ["spec.md"]                      │    │  │
│  │  │    - produces: ["plan.md"]                      │    │  │
│  │  │    - next: "tasks"                              │    │  │
│  │  └─────────────────────────────────────────────────┘    │  │
│  │         │                                                │  │
│  │         ▼                                                │  │
│  │  ┌─────────────────────────────────────────────────┐    │  │
│  │  │ 2. Run commandPreflight()                       │    │  │
│  │  │    ┌─────────────────────────────────────────┐  │    │  │
│  │  │    │ a. resolveWorkflowContext()             │  │    │  │
│  │  │    │    - Parse branch for Linear issue      │  │    │  │
│  │  │    │    - Find spec folder by issue ID       │  │    │  │
│  │  │    │    - Extract metadata                    │  │    │  │
│  │  │    │                                          │  │    │  │
│  │  │    │ b. validateArtifacts()                   │  │    │  │
│  │  │    │    - Check spec.md exists                │  │    │  │
│  │  │    │    - Verify required files present       │  │    │  │
│  │  │    │                                          │  │    │  │
│  │  │    │ c. validateLinearPolicy()                │  │    │  │
│  │  │    │    - Check issue ID if required          │  │    │  │
│  │  │    │                                          │  │    │  │
│  │  │    │ d. readWorkflowState()                   │  │    │  │
│  │  │    │    - Load workflow-state.json            │  │    │  │
│  │  │    │    - Detect artifact drift               │  │    │  │
│  │  │    │    - Generate resume message             │  │    │  │
│  │  │    └─────────────────────────────────────────┘  │    │  │
│  │  │         │                                        │    │  │
│  │  │         ▼                                        │    │  │
│  │  │    ┌─────────────────────────────────────────┐  │    │  │
│  │  │    │ Result: ok | warning | blocked           │  │    │  │
│  │  │    └─────────────────────────────────────────┘  │    │  │
│  │  └─────────────────────────────────────────────────┘    │  │
│  │         │                                                │  │
│  │         ▼                                                │  │
│  │  ┌─────────────────────────────────────────────────┐    │  │
│  │  │ 3. Format Response                              │    │  │
│  │  │    - If blocked: Show errors + fixes            │    │  │
│  │  │    - If ok/warning: Show context + resume msg   │    │  │
│  │  │    - Inject command prompt with full context    │    │  │
│  │  └─────────────────────────────────────────────────┘    │  │
│  └─────────────────────────────────────────────────────────┘  │
│         │                                                      │
│         ▼                                                      │
│  Agent executes command with validated context                │
│         │                                                      │
│         ▼                                                      │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │           Agent calls update_workflow_state             │  │
│  │  ┌─────────────────────────────────────────────────┐    │  │
│  │  │ - Mark step "plan" complete                     │    │  │
│  │  │ - Update completedSteps array                   │    │  │
│  │  │ - Compute artifact hashes for drift detection   │    │  │
│  │  │ - Update Linear status (optional)               │    │  │
│  │  │ - Write workflow-state.json                     │    │  │
│  │  └─────────────────────────────────────────────────┘    │  │
│  └─────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

### Core Components

#### 1. Workflow Context Resolution

**Source**: `src/shared/workflow-context.ts`

**Purpose**: Resolve spec folder, Linear issue, and branch context from multiple sources

**Resolution Priority**:
1. Explicit CLI args (`--spec-dir`, `--linear-issue-id`)
2. Spec folder detection from branch name
3. Spec folder metadata
4. Defaults

**Functions**:
- `resolveWorkflowContext()`: Main entry point
- `parseIssueIdFromBranch()`: Extract `LIF-123` from branch
- `findSpecFolderByIssueId()`: Locate spec folder
- `extractIssueIdFromSpecPath()`: Parse issue from folder name

#### 2. Preflight Validation

**Source**: `src/shared/command-preflight.ts`

**Purpose**: Validate prerequisites before command execution

**Validations**:
- **Artifact Check**: Required files exist (e.g., `spec.md` for `/plan`)
- **Linear Policy**: Issue ID required/optional/off
- **Workflow State**: Load previous state, detect drift
- **Generate Fixes**: Suggest commands to resolve issues

**Result Types**:
- `ok`: All validations passed
- `warning`: Non-blocking issues (drift detected, optional policy)
- `blocked`: Missing prerequisites, cannot proceed

#### 3. State Persistence

**Source**: `src/tools/spec/tools.ts` (`update_workflow_state` tool)

**Purpose**: Track workflow progress across sessions

**State Schema** (`workflow-state.json`):
```typescript
{
  currentStep: "plan",
  completedSteps: ["specify"],
  artifactHashes: {
    "spec.md": "a1b2c3d4...",
    "plan.md": "e5f6g7h8..."
  },
  linearIssueId: "LIF-123",
  linearStatus: "in_progress",
  createdAt: "2025-12-18T10:00:00Z",
  updatedAt: "2025-12-18T11:30:00Z",
  lastCommand: "/plan"
}
```

**Drift Detection**: SHA-256 hash comparison of artifacts between sessions

#### 4. Command Metadata

**Source**: Command frontmatter in `.opencode/command/*.md`

**New Fields**:
```yaml
step: plan              # Workflow step name
requires:               # Prerequisites
  - spec.md
produces:               # Output artifacts
  - plan.md
next: tasks             # Next recommended step
linear_status: in_progress  # Linear status after completion
category: workflow      # Command category for help
```

### Workflow Steps

| Step | Requires | Produces | Linear Status | Next |
|------|----------|----------|---------------|------|
| `specify` | - | spec.md | todo | plan |
| `plan` | spec.md | plan.md | in_progress | tasks |
| `tasks` | spec.md, plan.md | tasks.md | in_progress | implement |
| `implement` | spec.md, plan.md, tasks.md | implementation/ | in_progress | review |
| `review` | spec.md | reviews/ | in_review | test |
| `test` | spec.md | tests/ | in_review | - |

## Consequences

### Positive

- **Workflow Integrity**: Commands can't run out of order
- **Session Continuity**: Work resumes with full context after interruptions
- **Clear Progress**: Agents know what's done, what's next
- **Automatic Tracking**: State persisted without manual intervention
- **Self-Healing**: Drift detection catches manual edits
- **Better Help**: Commands organized by category and workflow
- **Linear Integration**: Workflow state syncs with issue status

### Negative

- **Overhead**: Preflight adds latency to command execution (~50-100ms)
- **State Complexity**: Workflow state file adds mental model complexity
- **Strict Ordering**: Can't easily skip steps (by design)
- **File Bloat**: Each spec folder gets `workflow-state.json`

### Mitigations

- **Caching**: Workflow context cached per command invocation
- **Escape Hatch**: Direct file editing bypasses validation
- **Clear Errors**: Preflight shows exactly what's missing and how to fix
- **Minimal State**: Only essential fields in state file

## Alternatives Rejected

### Manual Coordination
**Rejected because**: Agents frequently violate prerequisites; no enforcement

### Hardcoded Checks
**Rejected because**: Duplication across commands; hard to maintain consistency

### External Workflow Engine
**Rejected because**: Over-engineering; adds complexity and latency

## Implementation Timeline

- **LIF-65** (2025-12-17): Workflow infrastructure (context, preflight, state)
- **LIF-67** (2025-12-18): Integration (slashcommand tool, state tool, categories)

## Future Considerations

1. **Workflow Branching**: Support parallel workflows (e.g., `implement` + `test` simultaneously)
2. **State Rollback**: Undo workflow steps
3. **Workflow Templates**: Predefined workflows for different project types
4. **Visual Progress**: UI showing workflow completion status
5. **Workflow Hooks**: Trigger actions on step transitions
6. **Multi-Spec Workflows**: Coordinate workflows across features

## References

- Implementation: LIF-65, LIF-67
- Source: `src/shared/workflow-context.ts`
- Source: `src/shared/command-preflight.ts`
- Source: `src/tools/spec/tools.ts`
- Source: `src/tools/slashcommand/tools.ts`
- Commands: `.opencode/command/{specify,plan,tasks,implement,review,test}.md`
