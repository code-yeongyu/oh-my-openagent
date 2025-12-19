---
category: utils
description: Create checklist for feature validation, quality assurance, or compliance.
---

## User Input

```text
$ARGUMENTS
```

## Outline

Create a checklist for feature validation, quality assurance, or compliance.

1. **Detect spec folder**:
   - Use `get_feature_paths()` from `.cursor/scripts/bash/common.sh` to find current spec folder
   - Or use `--spec-dir` argument if provided
   - Verify relevant artifacts exist (spec.md, plan.md, tasks.md, etc.)

2. **Determine checklist type**:
   - If user specifies type (e.g., "requirements checklist", "pre-commit checklist"), use that
   - Otherwise, infer from context:
     - Spec exists → Requirements checklist
     - Plan exists → Architecture checklist
     - Implementation exists → Code quality checklist
     - All exist → Pre-deployment checklist

3. **Call Context Steward** (GOVERNANCE):
   - Read `.opencode/agent/context-steward.md`
   - Validate canonical path for checklist work
   - Ensure path follows `.cursor/specs/{SPEC_DIR_NAME}/checklists/` structure

4. **Load checklist template**:
   - Load `.cursor/templates/checklist-template.md` to understand structure

5. **Create checklist**:
   - Read relevant artifacts (spec.md, plan.md, tasks.md, etc.)
   - Generate checklist items based on:
     - User's specific request
     - Feature requirements from spec.md
     - Technical context from plan.md
     - Implementation details from tasks.md
   - Write to `{SPEC_DIR}/checklists/{checklist-type}.md`
   - **DO NOT** keep sample items from template

6. **Call Historian** (GOVERNANCE):
   - Read `.opencode/agent/historian.md`
   - Create changelog entry for checklist creation
   - Include: checklist type, items count, purpose

7. **Report completion**:
   - Checklist file path, items count, purpose

## Checklist Types

### Requirements Checklist
- Specification completeness
- Requirement clarity
- Success criteria measurability
- User story independence
- Edge case coverage

### Architecture Checklist
- Technical context completeness
- Architecture clarity
- Constitution compliance
- Research depth
- Data model design

### Code Quality Checklist
- Code standards compliance
- Test coverage
- Documentation completeness
- Performance considerations
- Security considerations

### Pre-Deployment Checklist
- All requirements met
- Tests passing
- Documentation complete
- Performance validated
- Security reviewed

## References

- Spec: `{SPEC_DIR}/spec.md`
- Plan: `{SPEC_DIR}/plan.md`
- Tasks: `{SPEC_DIR}/tasks.md`
- Template: `.cursor/templates/checklist-template.md`
- Context Steward: `.opencode/agent/context-steward.md`
- Historian: `.opencode/agent/historian.md`
