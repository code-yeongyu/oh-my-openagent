---
description: Review implementation from spec folder context.
step: review
requires:
  - spec.md
produces:
  - reviews/
next: test
linear_status: in_review
category: workflow
primary: true
handoffs:
  - label: Write Tests
    agent: test
    prompt: Write tests for this implementation
---

# Review

Workflow-aware code review that uses spec folder context.

## User Input

```text
$ARGUMENTS
```

## Steps

1. **Detect spec folder**:
   - Use `get_feature_paths()` from `.cursor/scripts/bash/common.sh`
   - Or use `--spec-dir` argument if provided
   - Verify `spec.md` exists (for requirements context)

2. **Load context**:
   - Read `spec.md` for requirements to verify
   - Read `plan.md` for architecture decisions
   - Read `tasks.md` for implementation scope

3. **Delegate to Code Reviewer Agent**:
   - Read `.opencode/agent/code-reviewer.md`
   - Provide spec folder context
   - Focus on: requirements alignment, architecture adherence, security

4. **Create review artifact**:
   - Write findings to `{SPEC_DIR}/reviews/{date}-review.md`
   - Include: passed checks, issues found, recommendations

5. **Call Historian** (GOVERNANCE):
   - Create changelog entry for review work

6. **Report completion**:
   - Review summary, issues found, readiness for `/test`
