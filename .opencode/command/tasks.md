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
   - Check for spec folder in `.cursor/specs/` directory
   - Or use `--spec-dir` argument if provided
   - Verify `plan.md` exists in spec folder
   - Verify `spec.md` exists (required for user stories)

2. **Load context**:
   - Read `spec.md` for user stories
   - Read `plan.md` for technical architecture
   - Check for existing `tasks.md` (update vs create)

3. **Delegate to Task Planner Agent**:
   - **GOVERNANCE**: Path validation and historian handled automatically by hooks
   - **Delegate the task breakdown work**:
     ```
     call_omo_agent(
       subagent_type="task-planner",
       run_in_background=false,
       prompt="""
       TASK: Create task breakdown from implementation plan
       
       SPEC_DIR: {SPEC_DIR}
       SPEC_FILE: {SPEC_DIR}/spec.md
       PLAN_FILE: {SPEC_DIR}/plan.md
       TASKS_FILE: {SPEC_DIR}/tasks.md
       
       CONTEXT:
       - Read spec.md for user stories and acceptance criteria
       - Read plan.md for technical architecture and phases
       - Organize tasks by user story for independent testability
       
       REQUIREMENTS:
       - Create phased task breakdown
       - Phase 1: Setup (shared infrastructure)
       - Phase 2: Foundational (blocking prerequisites)
       - Phase 3+: User Story phases (each independently testable)
       - Phase N: Polish & Cross-Cutting Concerns
       - Each task should have: ID, description, estimate, dependencies
       
       LINEAR INTEGRATION (LOCAL-FIRST):
       - Create tasks.md locally first
       - ASK USER before creating issues in Linear via MCP
       - If user approves, use Linear tools to create sub-issues
       
       DELIVERABLES:
       - tasks.md with complete task breakdown
       - Task table with ID, Task, Status, Estimate, Notes
       - Checkpoints for each phase
       """
     )
     ```

4. **Persist Workflow State** (REQUIRED):
   ```
   update_workflow_state({
     specPath: "{SPEC_DIR}",
     step: "tasks",
     linearStatus: "in_progress"
   })
   ```
   This enables session continuity and resume messages.

5. **Report completion**:
   - Tasks file path, number of tasks created, readiness for `/implement`

## Agent Integration

When Task Planner agent is invoked via `call_omo_agent`:
- **DO NOT** create spec folder (already exists)
- **USE** existing `SPEC_DIR`
- **READ** `spec.md` for user stories (required)
- **READ** `plan.md` for technical context (required)
- **RESPECT** provided canonical path
- **GOVERNANCE** is automatic (path validation, historian via hooks)
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
4. If user approves, use Linear tools to create sub-issues under parent issue

## References

- Spec: `{SPEC_DIR}/spec.md`
- Plan: `{SPEC_DIR}/plan.md` (required)
- Template: `.cursor/templates/tasks-template.md`
