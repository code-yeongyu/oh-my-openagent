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
   - Check for spec folder in `.cursor/specs/` directory
   - Or use `--spec-dir` argument if provided
   - Verify `spec.md` exists (for requirements context)

2. **Load context**:
   - Read `spec.md` for requirements to verify
   - Read `plan.md` for architecture decisions
   - Read `tasks.md` for implementation scope

3. **Delegate to Oracle Agent for Code Review**:
   - **GOVERNANCE**: Path validation and historian handled automatically by hooks
   - **Delegate the review work**:
     ```
     call_omo_agent(
       subagent_type="oracle",
       run_in_background=false,
       prompt="""
       TASK: Comprehensive code review for feature implementation
       
       SPEC_DIR: {SPEC_DIR}
       SPEC_FILE: {SPEC_DIR}/spec.md
       PLAN_FILE: {SPEC_DIR}/plan.md
       TASKS_FILE: {SPEC_DIR}/tasks.md
       
       CONTEXT:
       - Read spec.md for requirements alignment
       - Read plan.md for architecture adherence
       - Read tasks.md for implementation scope
       - Identify changed files from recent implementation
       
       REVIEW FOCUS:
       1. Requirements Alignment - Does implementation satisfy spec requirements?
       2. Architecture Adherence - Does code follow plan.md architecture?
       3. Security - Are there security vulnerabilities?
       4. Code Quality - Is code maintainable, readable, tested?
       5. Performance - Are there performance concerns?
       6. Edge Cases - Are edge cases handled?
       
       DELIVERABLES:
       - Review findings written to {SPEC_DIR}/reviews/{date}-review.md
       - Include: passed checks, issues found, recommendations
       - Severity levels: critical, major, minor, suggestion
       """
     )
     ```

4. **Create review artifact**:
   - Write findings to `{SPEC_DIR}/reviews/{date}-review.md`
   - Include: passed checks, issues found, recommendations

5. **Persist Workflow State** (REQUIRED):
   ```
   update_workflow_state({
     specPath: "{SPEC_DIR}",
     step: "review",
     linearStatus: "in_review"
   })
   ```
   This enables session continuity and resume messages.

6. **Report completion**:
   - Review summary, issues found, readiness for `/test`
