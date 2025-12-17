---
description: Perform thorough code review for functionality, maintainability, and security.
---

# Code Review

## Overview

Perform a thorough code review that verifies functionality, maintainability, and
security before approving a change. Focus on architecture, readability,
performance implications, and provide actionable suggestions for improvement.

## User Input

```text
$ARGUMENTS
```

## Steps

1. **Understand the change**
    - Read the PR description and related issues for context
    - Identify the scope of files and features impacted
    - Note any assumptions or questions to clarify with the author

2. **Validate functionality**
    - Confirm the code delivers the intended behavior
    - Exercise edge cases or guard conditions mentally or by running locally
    - Check error handling paths and logging for clarity

3. **Assess quality**
    - Ensure functions are focused, names are descriptive, and code is readable
    - Watch for duplication, dead code, or missing tests
    - Verify documentation and comments reflect the latest changes

4. **Review security and risk**
    - Look for injection points, insecure defaults, or missing validation
    - Confirm secrets or credentials are not exposed
    - Evaluate performance or scalability impacts of the change

5. **Engage Code Reviewer Agent** (for comprehensive review):
    - Read `.opencode/agent/code-reviewer.md`
    - Follow technical_commit_review.mdc methodology
    - Evaluate ALL 10 cross-rule compliance checklists with file:line evidence

6. **Call Historian** (GOVERNANCE):
    - Read `.opencode/agent/historian.md`
    - Create changelog entry for review work
    - Include: files reviewed, findings, recommendations

## Review Checklist

### Functionality

- [ ] Intended behavior works and matches requirements
- [ ] Edge cases handled gracefully
- [ ] Error handling is appropriate and informative

### Code Quality

- [ ] Code structure is clear and maintainable
- [ ] No unnecessary duplication or dead code
- [ ] Tests/documentation updated as needed

### Security & Safety

- [ ] No obvious security vulnerabilities introduced
- [ ] Inputs validated and outputs sanitized
- [ ] Sensitive data handled correctly

## Additional Review Notes

- Architecture and design decisions considered
- Performance bottlenecks or regressions assessed
- Coding standards and best practices followed
- Resource management, error handling, and logging reviewed
- Suggested alternatives, additional test cases, or documentation updates captured

Provide constructive feedback with concrete examples and actionable guidance for
the author.

## References

- Code Reviewer Agent: `.opencode/agent/code-reviewer.md`
- Historian: `.opencode/agent/historian.md`
- Technical Review Rule: `.cursor/rules/05-quality/technical_commit_review.mdc`
