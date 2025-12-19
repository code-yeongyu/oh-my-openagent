# Add Spec-to-Todo Workflow to OmO

**Linear Issue**: [LIF-58](https://linear.app/lifelogger/issue/LIF-58/add-spec-to-todo-workflow-to-omo)
**Created**: 2025-12-18
**Status**: In Progress
**Dependency**: LIF-57 (Governance Awareness) ✅ COMPLETE

## Overview

Teach OmO to read spec folder artifacts (`tasks.md`) and convert them to OpenCode todos for execution. This enables **persistent planning** that survives session boundaries.

**Key Insight**: Todos are NOT replaced by specs. Todos are CREATED FROM spec content.

## Background

Currently OmO uses ephemeral todos that are lost when sessions end. The `.cursor/specs/` and `context/specs/` folders contain persistent planning artifacts that should inform todo creation:

- `spec.md` - Requirements and user stories
- `plan.md` - Architecture and implementation plan  
- `tasks.md` - Task breakdown (PRIMARY SOURCE for todos)
- `status.md` - Current status tracking

## User Stories

- As an OmO user, I want OmO to detect existing spec folders when I mention a Linear issue, so that I don't lose planning context between sessions
- As an OmO user, I want OmO to convert `tasks.md` entries into OpenCode todos, so that I can track progress with the native todo system
- As an OmO user, I want OmO to resume work by re-reading `tasks.md`, so that I can continue where I left off

## Flow

```
1. User mentions Linear issue (e.g., "work on LIF-123")
2. OmO checks for spec folder: .cursor/specs/LIF-123-*/ or context/specs/LIF-123-*/
3. If found, OmO reads: tasks.md (task breakdown table)
4. OmO creates: todowrite([{content: "Task 1 from tasks.md"}, ...])
5. OmO executes: Each todo, marking complete with evidence
6. OmO updates: tasks.md status column (optional)
```

## Requirements

### Functional Requirements

1. Detect if working on a spec-tracked feature (Linear issue or feature name)
2. Check for existing spec folder in `.cursor/specs/` or `context/specs/`
3. Read and parse `tasks.md` table format
4. Convert tasks to OpenCode todos with proper IDs
5. Execute todos with evidence gathering
6. Optionally update `tasks.md` status column on completion

### Non-Functional Requirements

1. Prompt-only changes (no new code/tools required)
2. Backward compatible - works with or without spec folders
3. Clear documentation in OmO prompt for when to use spec workflow

## Acceptance Criteria

- [ ] OmO detects spec folders when Linear issue mentioned
- [ ] OmO reads `tasks.md` and creates corresponding todos
- [ ] Todos reference their source (e.g., "from tasks.md T001")
- [ ] OmO can resume work by re-reading `tasks.md`
- [ ] Works with both `.cursor/specs/` and `context/specs/` paths
- [ ] `<Spec_Workflow>` section added to OmO prompt
- [ ] `<Decision_Matrix>` updated with spec workflow triggers
