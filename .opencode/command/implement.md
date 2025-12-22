---
description: Implement feature according to plan and tasks.
step: implement
requires:
  - spec.md
  - plan.md
  - tasks.md
produces:
  - implementation/
next: review
linear_status: in_progress
category: workflow
primary: true
handoffs:
  - label: Review Code
    agent: code-review
    prompt: Review the implementation
  - label: Write Tests
    agent: test-engineer
    prompt: Write tests for this implementation
---

## User Input

```text
$ARGUMENTS
```

## Outline

Implement the feature according to the plan and tasks in the current spec folder.

1. **Detect spec folder**:
   - Check for spec folder in `.cursor/specs/` directory
   - Or use `--spec-dir` argument if provided
   - Verify `plan.md` exists (required)
   - Verify `tasks.md` exists (required)
   - Verify `spec.md` exists (for context)

2. **Load context**:
   - Read `spec.md` for requirements
   - Read `plan.md` for architecture
   - Read `tasks.md` for task breakdown
   - Identify current task to implement

3. **Delegate to Implementation Specialist Agent**:
   - **GOVERNANCE**: Path validation and historian handled automatically by hooks
   - **Delegate the implementation work**:
     ```
     call_omo_agent(
       subagent_type="implementation-specialist",
       run_in_background=false,
       prompt="""
       TASK: Implement feature according to plan and tasks
       
       SPEC_DIR: {SPEC_DIR}
       SPEC_FILE: {SPEC_DIR}/spec.md
       PLAN_FILE: {SPEC_DIR}/plan.md
       TASKS_FILE: {SPEC_DIR}/tasks.md
       
       CONTEXT:
       - Read plan.md for architecture and technical decisions
       - Read tasks.md for task breakdown and order
       - Read spec.md for requirements context
       - Use context7 MCP for library patterns if needed
       
       REQUIREMENTS:
       - Follow plan.md architecture exactly
       - Implement tasks from tasks.md in order
       - Respect user story organization (independent testability)
       - Write production-ready code (not prototypes)
       - Follow project coding standards
       
       DELEGATION (if needed):
       - Delegate to backend-typescript for TypeScript backend work
       - Delegate to frontend-react for React frontend work
       - Delegate to other specialists as appropriate
       
       DELIVERABLES:
       - Implementation code in appropriate directories
       - Implementation notes in {SPEC_DIR}/implementation/
       - Updated task status in tasks.md
       """
     )
     ```

4. **Persist Workflow State** (REQUIRED):
   ```
   update_workflow_state({
     specPath: "{SPEC_DIR}",
     step: "implement",
     linearStatus: "in_progress"
   })
   ```
   This enables session continuity and resume messages.

5. **Report completion**:
   - Implementation summary, files created/modified, readiness for `/review` or `/test`

## Agent Integration

When Implementation Specialist agent is invoked via `call_omo_agent`:
- **DO NOT** create spec folder (already exists)
- **USE** existing `SPEC_DIR`
- **READ** `plan.md` for architecture (required)
- **READ** `tasks.md` for task breakdown (required)
- **READ** `spec.md` for requirements context
- **RESPECT** provided canonical path
- **GOVERNANCE** is automatic (path validation, historian via hooks)
- **WRITE** implementation notes to `{SPEC_DIR}/implementation/`

## Implementation Guidelines

- Follow plan.md architecture exactly
- Implement tasks from tasks.md in order
- Respect user story organization (independent testability)
- Use context7 for library patterns and best practices
- Write production-ready code (not prototypes)
- Follow project coding standards

## References

- Spec: `{SPEC_DIR}/spec.md`
- Plan: `{SPEC_DIR}/plan.md` (required)
- Tasks: `{SPEC_DIR}/tasks.md` (required)
