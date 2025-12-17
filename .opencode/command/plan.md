---
description: Create implementation plan from feature specification.
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
   - Use `get_feature_paths()` from `.cursor/scripts/bash/common.sh` to find current spec folder
   - Or use `--spec-dir` argument if provided
   - Verify `spec.md` exists in spec folder

2. **Call setup-plan.sh script**:
   ```bash
   .cursor/scripts/bash/setup-plan.sh --json --spec-dir "{SPEC_DIR}"
   ```
   - Parse JSON output to get `IMPL_PLAN` path
   - Script creates `plan.md` from template

3. **Call Context Steward** (GOVERNANCE):
   - Read `.opencode/agent/context-steward.md`
   - Validate canonical path for plan work
   - Ensure path follows `.cursor/specs/{SPEC_DIR_NAME}/` structure

4. **Load plan template**:
   - Load `.cursor/templates/plan-template.md` to understand structure

5. **Engage Strategic Architect Agent**:
   - Read `.opencode/agent/strategic-architect.md` (COMPLETE, no offset/limit)
   - Adopt Strategic Architect persona
   - Create `plan.md` at `IMPL_PLAN` path (from script JSON output)
   - **DO NOT re-create spec folder** - use `SPEC_DIR` from script
   - Follow Strategic Architect steps exactly
   - Use context7 MCP for library research if needed
   - **NOTE**: Strategic Architect will also create Mintlify docs in `docs/architecture/` (dual workflow)

6. **Call Historian** (GOVERNANCE):
   - Read `.opencode/agent/historian.md`
   - Create changelog entry for Strategic Architect work
   - Include: mode, scope, files created, architectural decisions

7. **Report completion**:
   - Plan file path, readiness for next phase (`/tasks` or `/implement`)

## Agent Integration

When Strategic Architect agent is invoked:
- **DO NOT** create spec folder (already exists)
- **USE** `SPEC_DIR` from script JSON output
- **RESPECT** provided canonical path
- **READ** `spec.md` from same spec folder for context
- **CALL** Context Steward before writing files
- **CALL** Historian after completing work
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
- Strategic Architect: `.opencode/agent/strategic-architect.md`
