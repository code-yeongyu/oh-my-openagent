---
description: Implement feature according to plan and tasks.
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
   - Use `get_feature_paths()` from `.cursor/scripts/bash/common.sh` to find current spec folder
   - Or use `--spec-dir` argument if provided
   - Verify `plan.md` exists (required)
   - Verify `tasks.md` exists (required)
   - Verify `spec.md` exists (for context)

2. **Call Context Steward** (GOVERNANCE):
   - Read `.opencode/agent/context-steward.md`
   - Validate canonical path for implementation work
   - Ensure path follows `.cursor/specs/{SPEC_DIR_NAME}/` structure

3. **Engage Implementation Specialist Agent**:
   - Read `.opencode/agent/implementation-specialist.md` (COMPLETE, no offset/limit)
   - Adopt Implementation Specialist persona
   - **DO NOT re-create spec folder** - use existing `SPEC_DIR`
   - Follow Implementation Specialist steps exactly
   - Use context7 MCP for library patterns if needed
   - Use chrome-devtools MCP for frontend validation if needed
   - Write implementation notes to `{SPEC_DIR}/implementation/`

4. **Call Historian** (GOVERNANCE):
   - Read `.opencode/agent/historian.md`
   - Create changelog entry for Implementation Specialist work
   - Include: mode, scope, files created/modified, implementation decisions

5. **Report completion**:
   - Implementation summary, files created/modified, readiness for `/code-review` or `/test`

## Agent Integration

When Implementation Specialist agent is invoked:
- **DO NOT** create spec folder (already exists)
- **USE** existing `SPEC_DIR`
- **READ** `plan.md` for architecture (required)
- **READ** `tasks.md` for task breakdown (required)
- **READ** `spec.md` for requirements context
- **RESPECT** provided canonical path
- **CALL** Context Steward before writing files
- **CALL** Historian after completing work
- **WRITE** implementation notes to `{SPEC_DIR}/implementation/`

## Implementation Guidelines

- Follow plan.md architecture exactly
- Implement tasks from tasks.md in order
- Respect user story organization (independent testability)
- Use context7 for library patterns and best practices
- Use chrome-devtools for frontend validation
- Write production-ready code (not prototypes)
- Follow project coding standards

## References

- Spec: `{SPEC_DIR}/spec.md`
- Plan: `{SPEC_DIR}/plan.md` (required)
- Tasks: `{SPEC_DIR}/tasks.md` (required)
- Implementation Specialist: `.opencode/agent/implementation-specialist.md`
