---
description: Comprehensive pull request review with security checks and actionable feedback.
---

# Review PR

## Overview

Execute a thorough pull request review with automated security checks, code quality validation, and actionable feedback. Ensures PRs meet quality standards before merging.

## User Input

```text
$ARGUMENTS
```

**Examples**:
- `/review-pr 123` - Review PR #123
- `/review-pr https://github.com/org/repo/pull/123` - Review via URL
- `/review-pr branch-name` - Review branch against main

## Steps

### Phase 1: Context Gathering (5-10 minutes)

1. **PR Information**
   - Fetch PR details (title, description, files changed)
   - Identify linked Linear issue
   - Check PR size and scope
   - Review commit history

2. **Context Analysis**
   - Read Linear issue for requirements
   - Check acceptance criteria
   - Identify risk areas
   - Determine review depth needed

### Phase 2: Security Review (15-30 minutes)

3. **Security Checks**
   - Input validation present
   - No SQL injection vulnerabilities
   - No XSS vulnerabilities
   - Authentication/authorization correct
   - No secrets in code
   - Error messages don't leak info
   - HTTPS/TLS used for sensitive data
   - Rate limiting on public endpoints

4. **Data Security**
   - PII handled correctly
   - Encryption for sensitive data
   - Secure session management
   - CORS configured properly

### Phase 3: Code Quality Review (15-30 minutes)

5. **Code Quality Checks**
   - Functions < 30 lines
   - Files < 400 lines
   - Clear naming conventions
   - Proper error handling
   - No code duplication
   - Comments for complex logic
   - Consistent formatting

6. **Architecture Checks**
   - Follows AGENTS.md patterns
   - Proper layer separation
   - Dependencies point correctly
   - No circular dependencies
   - Appropriate abstractions

### Phase 4: Testing Review (15-30 minutes)

7. **Test Coverage**
   - Unit tests for new code
   - Integration tests for APIs
   - E2E tests for user flows
   - Coverage >80%
   - Edge cases tested
   - Error cases tested

8. **Test Quality**
   - Tests are readable
   - Tests are maintainable
   - No flaky tests
   - Appropriate assertions
   - Mock/stub usage correct

### Phase 5: Performance Review (10-15 minutes)

9. **Performance Checks**
   - No N+1 query problems
   - Efficient algorithms
   - Appropriate caching
   - Database indexes present
   - No unnecessary computations
   - Async operations where appropriate

### Phase 6: Documentation Review (10-15 minutes)

10. **Documentation Checks**
    - API changes documented
    - README updated if needed
    - CHANGELOG updated
    - Code comments for complex logic
    - Migration guide for breaking changes

### Phase 7: Final Report (5-10 minutes)

11. **Generate Report**
    - Summarize findings
    - Categorize by severity
    - Provide specific recommendations
    - Post to Linear issue
    - Comment on PR

12. **Decision**
    - **APPROVE**: No issues, ready to merge
    - **REQUEST CHANGES**: Issues found, needs fixes
    - **BLOCK**: Critical issues, do not merge

## Review Severity Levels

### Critical (BLOCK)
- Security vulnerabilities
- Data loss risks
- Breaking changes without migration
- No tests for critical paths

### Major (REQUEST CHANGES)
- Code quality issues
- Missing error handling
- Insufficient test coverage
- Performance problems

### Minor (APPROVE with suggestions)
- Style inconsistencies
- Missing documentation
- Minor optimizations
- Refactoring opportunities

## Review Checklist

### Security
- [ ] Input validation on all external data
- [ ] SQL queries use parameterized statements
- [ ] No XSS vulnerabilities
- [ ] Authentication/authorization checks present
- [ ] No hardcoded secrets

### Code Quality
- [ ] Functions are focused and < 30 LOC
- [ ] Files are organized and < 400 LOC
- [ ] Naming is clear and consistent
- [ ] Error handling is comprehensive

### Testing
- [ ] Unit tests for business logic
- [ ] Integration tests for APIs
- [ ] Coverage >80%
- [ ] Edge cases covered

### Performance
- [ ] No N+1 query problems
- [ ] Efficient algorithms used
- [ ] Caching where appropriate

## Agent Delegation

- **Code Reviewer**: Read `.opencode/agent/code-reviewer.md` for comprehensive review
- **Test Engineer**: Read `.opencode/agent/test-engineer.md` for test coverage review
- **Documentation Master**: Read `.opencode/agent/documentation-master.md` for docs review
- **Linear Coordinator**: Read `.opencode/agent/linear-coordinator.md` for Linear integration

## Call Historian (GOVERNANCE)

- Read `.opencode/agent/historian.md`
- Create changelog entry for review work
- Include: PR reviewed, findings, decision

## References

- Code Reviewer: `.opencode/agent/code-reviewer.md`
- Test Engineer: `.opencode/agent/test-engineer.md`
- Documentation Master: `.opencode/agent/documentation-master.md`
- Linear Coordinator: `.opencode/agent/linear-coordinator.md`
- Historian: `.opencode/agent/historian.md`
