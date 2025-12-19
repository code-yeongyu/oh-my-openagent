---
category: quality
description: Execute full test suite and systematically fix any failures.
---

# Run All Tests and Fix Failures

## Overview

Execute the full test suite and systematically fix any failures, ensuring code quality and functionality.

## User Input

```text
$ARGUMENTS
```

## Steps

1. **Run test suite**
   - Execute all tests in the project
   - Capture output and identify failures
   - Check both unit and integration tests
   - Note test execution time

2. **Analyze failures**
   - Categorize by type: flaky, broken, new failures
   - Prioritize fixes based on impact
   - Check if failures are related to recent changes
   - Identify root causes

3. **Fix issues systematically**
   - Start with the most critical failures
   - Fix one issue at a time
   - Re-run tests after each fix
   - Document fixes made

4. **Handle flaky tests**
   - Identify non-deterministic tests
   - Fix race conditions or timing issues
   - Add proper test isolation

5. **Validate fixes**
   - Run full test suite again
   - Ensure all tests pass
   - Check for any regressions

6. **Call Test Engineer** (for complex failures):
   - Read `.opencode/agent/test-engineer.md`
   - Get expert help on difficult test issues

7. **Call Historian** (GOVERNANCE):
   - Read `.opencode/agent/historian.md`
   - Create changelog entry for test fix work
   - Include: tests fixed, root causes, improvements made

## Test Recovery Checklist

- [ ] Full test suite executed
- [ ] Failures categorized and tracked
- [ ] Root causes identified
- [ ] Fixes implemented
- [ ] Tests re-run with passing results
- [ ] No regressions introduced
- [ ] Follow-up improvements noted

## References

- Test Engineer: `.opencode/agent/test-engineer.md`
- Historian: `.opencode/agent/historian.md`
- Testing Standards: `.cursor/rules/05-quality/`
