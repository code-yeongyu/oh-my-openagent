---
description: Create implementation plan from feature specification.
step: plan
requires:
  - spec.md
produces:
  - plan.md
next: tasks
linear_status: in_progress
category: workflow
primary: true
handoffs:
  - label: Create Tasks
    agent: tasks
    prompt: Create tasks from this plan
  - label: Implement Feature
    agent: implement
    prompt: Implement this feature according to the plan
---

## User Input

```text
$ARGUMENTS
```

## Outline

Create an implementation plan from the feature specification in the current spec folder.

1. **Detect spec folder**:
   - Check for spec folder in `.cursor/specs/` directory
   - Or use `--spec-dir` argument if provided
   - Verify `spec.md` exists in spec folder

2. **Load context**:
   - Read `spec.md` for requirements
   - Check for existing `plan.md` (update vs create)
   - Load constitution from `.cursor/memory/constitution.md` if exists

3. **Delegate to Strategic Planner Agent**:
   - **GOVERNANCE**: Path validation and historian handled automatically by hooks
   - **Delegate the planning work**:
     ```
     call_omo_agent(
       subagent_type="strategic-planner",
       run_in_background=false,
       prompt="""
       TASK: Create implementation plan for feature specification
       
       SPEC_DIR: {SPEC_DIR}
       SPEC_FILE: {SPEC_DIR}/spec.md
       PLAN_FILE: {SPEC_DIR}/plan.md
       
       CONTEXT:
       - Read spec.md for requirements and user stories
       - Check constitution at .cursor/memory/constitution.md for project constraints
       - Use context7 MCP for library research if needed
       
       REQUIREMENTS:
       - Create technical architecture that satisfies spec requirements
       - Include data models, API contracts, project structure
       - Reference constitution gates for compliance
       - Document technical decisions and tradeoffs
       
       DELIVERABLES:
       - plan.md with complete implementation plan
       - Technical Context section (language, dependencies, storage, testing, platform)
       - Data Model (Phase 1 design)
       - API Contracts (if applicable)
       - Project Structure (documentation and source code layout)
       - Also create architecture docs in docs/architecture/ if applicable
       """
     )
     ```

4. **Persist Workflow State** (REQUIRED):
   ```
   update_workflow_state({
     specPath: "{SPEC_DIR}",
     step: "plan",
     linearStatus: "in_progress"
   })
   ```
   This enables session continuity and resume messages.

5. **Report completion**:
   - Plan file path, readiness for next phase (`/tasks` or `/implement`)

## Agent Integration

When Strategic Planner agent is invoked via `call_omo_agent`:
- **DO NOT** create spec folder (already exists)
- **USE** `SPEC_DIR` from detection step
- **RESPECT** provided canonical path
- **READ** `spec.md` from same spec folder for context
- **GOVERNANCE** is automatic (path validation, historian via hooks)
- **SUPPORT** dual workflow: Creates both `.cursor/specs/` and `docs/architecture/`

## Plan Structure

The plan should include:
- Summary (from spec.md)
- Technical Context (language, dependencies, storage, testing, platform)
- Constitution Check (gates from `.cursor/memory/constitution.md`)
- Research (Phase 0 findings using context7)
- Data Model (Phase 1 design)
- Contracts (Phase 1 API contracts)
- Project Structure (documentation and source code layout)
- Complexity Tracking (if constitution violations)

## References

- Spec: `{SPEC_DIR}/spec.md`
- Template: `.cursor/templates/plan-template.md`
- Constitution: `.cursor/memory/constitution.md`
