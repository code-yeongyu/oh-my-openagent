---
description: Write and run tests for implementation from spec folder context.
step: test
requires:
  - spec.md
produces:
  - tests/
next: null
linear_status: in_review
category: workflow
primary: true
handoffs:
  - label: Review Code
    agent: review
    prompt: Review the implementation
---

# Test

Workflow-aware testing that uses spec folder context.

## User Input

```text
$ARGUMENTS
```

## Steps

1. **Detect spec folder**:
   - Check for spec folder in `.cursor/specs/` directory
   - Or use `--spec-dir` argument if provided
   - Verify `spec.md` exists (for test scenarios)

2. **Load context**:
   - Read `spec.md` for acceptance criteria to verify
   - Read `plan.md` for architecture (integration test boundaries)
   - Read `tasks.md` for feature scope

3. **Delegate to Test Specialist Agent**:
   - **GOVERNANCE**: Path validation and historian handled automatically by hooks
   - **Delegate the testing work**:
     ```
     call_omo_agent(
       subagent_type="test-specialist",
       run_in_background=false,
       prompt="""
       TASK: Write and run tests for feature implementation
       
       SPEC_DIR: {SPEC_DIR}
       SPEC_FILE: {SPEC_DIR}/spec.md
       PLAN_FILE: {SPEC_DIR}/plan.md
       TASKS_FILE: {SPEC_DIR}/tasks.md
       
       CONTEXT:
       - Read spec.md for acceptance criteria and user stories
       - Read plan.md for architecture and integration boundaries
       - Read tasks.md for feature scope
       - Identify implementation files to test
       
       TEST COVERAGE:
       1. Unit Tests - Test individual functions/components
       2. Integration Tests - Test component interactions
       3. Acceptance Tests - Verify spec acceptance criteria
       
       REQUIREMENTS:
       - Follow project testing conventions
       - Use existing test framework and patterns
       - Achieve meaningful coverage (not 100% for its own sake)
       - Test edge cases identified in spec
       
       DELIVERABLES:
       - Test plan written to {SPEC_DIR}/testing/test-plan.md
       - Test files per project conventions
       - Test run results and coverage report
       """
     )
     ```

4. **Create test artifacts**:
   - Write test plan to `{SPEC_DIR}/testing/test-plan.md`
   - Generate test files per project conventions
   - Run tests and capture results

5. **Persist Workflow State** (REQUIRED):
   ```
   update_workflow_state({
     specPath: "{SPEC_DIR}",
     step: "test",
     linearStatus: "in_review"
   })
   ```
   This enables session continuity and resume messages.

6. **Report completion**:
   - Test summary, coverage, pass/fail counts, next steps
