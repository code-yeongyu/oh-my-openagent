---
description: Create task breakdown from implementation plan.
step: tasks
requires:
  - spec.md
  - plan.md
produces:
  - tasks.md
next: implement
linear_status: in_progress
category: workflow
primary: true
handoffs:
  - label: Implement Tasks
    agent: implement
    prompt: Implement these tasks
---

## User Input

```text
$ARGUMENTS
```

## Outline

Create a task breakdown from the implementation plan in the current spec folder.

1. **Detect spec folder**:
   - Use `get_feature_paths()` from `.cursor/scripts/bash/common.sh` to find current spec folder
   - Or use `--spec-dir` argument if provided
   - Verify `plan.md` exists in spec folder
   - Verify `spec.md` exists (required for user stories)

2. **Call Context Steward** (GOVERNANCE):
   - Read `.opencode/agent/context-steward.md`
   - Validate canonical path for tasks work
   - Ensure path follows `.cursor/specs/{SPEC_DIR_NAME}/` structure

3. **Load tasks template**:
   - Load `.cursor/templates/tasks-template.md` to understand structure

4. **Engage Linear Coordinator Agent**:
   - Read `.opencode/agent/linear-coordinator.md` (COMPLETE, no offset/limit)
   - Adopt Linear Coordinator persona
   - Create `tasks.md` at `{SPEC_DIR}/tasks.md`
   - **DO NOT re-create spec folder** - use existing `SPEC_DIR`
   - Follow Linear Coordinator steps exactly
   - **LOCAL-FIRST**: Create tasks locally, ask user before creating Linear issues

5. **Call Historian** (GOVERNANCE):
   - Read `.opencode/agent/historian.md`
   - Create changelog entry for Linear Coordinator work
   - Include: mode, scope, files created, tasks created

6. **Report completion**:
   - Tasks file path, number of tasks created, readiness for `/implement`

7. **Persist Workflow State** (REQUIRED):
   ```
   update_workflow_state({
     specPath: "{SPEC_DIR}",
     step: "tasks",
     linearStatus: "in_progress"
   })
   ```
   This enables session continuity and resume messages.

## Agent Integration

When Linear Coordinator agent is invoked:
- **DO NOT** create spec folder (already exists)
- **USE** existing `SPEC_DIR`
- **READ** `spec.md` for user stories (required)
- **READ** `plan.md` for technical context (required)
- **RESPECT** provided canonical path
- **CALL** Context Steward before writing files
- **CALL** Historian after completing work
- **LOCAL-FIRST POLICY**: Create tasks locally first, ask user before Linear writes

## Task Organization

Tasks MUST be organized by user story:
- Phase 1: Setup (shared infrastructure)
- Phase 2: Foundational (blocking prerequisites)
- Phase 3+: User Story 1, 2, 3... (each independently testable)
- Phase N: Polish & Cross-Cutting Concerns

Each user story phase should include:
- Goal and Independent Test
- Tests (if requested in spec)
- Implementation tasks
- Checkpoint validation

## Linear Integration

**LOCAL-FIRST POLICY**:
1. Create `tasks.md` locally first
2. Optionally create Linear issues locally in `{SPEC_DIR}/linear/`
3. **ASK USER** before creating issues in Linear via MCP
4. If user approves, delegate to Linear Coordinator for Linear issue creation

## References

- Spec: `{SPEC_DIR}/spec.md`
- Plan: `{SPEC_DIR}/plan.md` (required)
- Template: `.cursor/templates/tasks-template.md`
- Linear Coordinator: `.opencode/agent/linear-coordinator.md`
