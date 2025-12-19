---
category: quality
description: Create comprehensive unit tests for the current code with high coverage.
---

# Write Unit Tests

## Overview

Create comprehensive unit tests for the current code. Include test coverage for all public methods, edge cases, and error conditions.

## User Input

```text
$ARGUMENTS
```

## Steps

1. **Analyze code to test**
   - Identify all public methods and functions
   - Understand the code's behavior and dependencies
   - Note edge cases and error conditions
   - Identify external dependencies to mock

2. **Plan test coverage**
   - Test all public methods and functions
   - Cover edge cases and boundary conditions
   - Test both positive and negative scenarios
   - Aim for high code coverage (>80%)

3. **Structure tests properly**
   - Use the project's testing framework conventions
   - Write clear, descriptive test names
   - Follow the Arrange-Act-Assert pattern
   - Group related tests logically

4. **Write test cases**
   - Happy path scenarios
   - Edge cases and boundary conditions
   - Error handling and exception cases
   - Mock external dependencies appropriately

5. **Ensure test quality**
   - Make tests independent and isolated
   - Ensure tests are deterministic and repeatable
   - Keep tests simple and focused on one thing
   - Add helpful assertion messages

6. **Validate tests**
   - Run tests to verify they pass/fail as expected
   - Check coverage metrics
   - Ensure no flaky tests

7. **Call Historian** (GOVERNANCE):
   - Read `.opencode/agent/historian.md`
   - Create changelog entry for test creation
   - Include: test file created, coverage achieved, test count

## Test Quality Checklist

- [ ] All public methods tested
- [ ] Edge cases covered
- [ ] Error conditions tested
- [ ] Tests are independent
- [ ] Tests are deterministic
- [ ] Mocks used appropriately
- [ ] Coverage >80%

## References

- Historian: `.opencode/agent/historian.md`
- Test Engineer: `.opencode/agent/test-engineer.md`
- Testing Standards: `.cursor/rules/05-quality/`
