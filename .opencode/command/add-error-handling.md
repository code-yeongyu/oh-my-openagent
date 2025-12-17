---
description: Implement comprehensive error handling for robust and resilient code.
---

# Add Error Handling

## Overview

Implement comprehensive error handling for the current code. Focus on error detection, handling strategy, recovery mechanisms, and user experience.

## User Input

```text
$ARGUMENTS
```

## Steps

1. **Error Detection**
   - Identify potential failure points and edge cases
   - Find unhandled exceptions and error conditions
   - Detect missing validation and boundary checks
   - Analyze async operations and network calls

2. **Error Handling Strategy**
   - Implement try-catch blocks where appropriate
   - Add input validation and sanitization
   - Create meaningful error messages and logging
   - Design graceful degradation for non-critical failures

3. **Recovery Mechanisms**
   - Implement retry logic for transient failures
   - Add fallback options for service unavailability
   - Create circuit breakers for external dependencies
   - Design proper error propagation and handling

4. **User Experience**
   - Provide clear error messages to users
   - Implement proper error status codes for APIs
   - Add loading states and error boundaries for UI
   - Include helpful suggestions for error resolution

5. **Validate error handling**
   - Test error scenarios
   - Verify logging captures necessary context
   - Ensure errors don't leak sensitive information

6. **Call Historian** (GOVERNANCE):
   - Read `.opencode/agent/historian.md`
   - Create changelog entry for error handling work
   - Include: error types handled, recovery mechanisms added

## Error Handling Checklist

- [ ] All failure points identified
- [ ] Try-catch blocks implemented
- [ ] Input validation added
- [ ] Error messages are clear
- [ ] Retry logic for transient failures
- [ ] Graceful degradation implemented
- [ ] Errors logged appropriately
- [ ] No sensitive info leaked

## References

- Historian: `.opencode/agent/historian.md`
- Error Resilience: `.cursor/memory/constitution.md` (Principle VI)
