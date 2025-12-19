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
   - Use `get_feature_paths()` from `.cursor/scripts/bash/common.sh`
   - Or use `--spec-dir` argument if provided
   - Verify `spec.md` exists (for test scenarios)

2. **Load context**:
   - Read `spec.md` for acceptance criteria to verify
   - Read `plan.md` for architecture (integration test boundaries)
   - Read `tasks.md` for feature scope

3. **Delegate to Test Engineer Agent**:
   - Read `.opencode/agent/test-engineer.md`
   - Provide spec folder context
   - Focus on: unit tests, integration tests, acceptance tests

4. **Create test artifacts**:
   - Write test plan to `{SPEC_DIR}/testing/test-plan.md`
   - Generate test files per project conventions
   - Run tests and capture results

5. **Call Historian** (GOVERNANCE):
   - Create changelog entry for testing work

6. **Report completion**:
   - Test summary, coverage, pass/fail counts, next steps
