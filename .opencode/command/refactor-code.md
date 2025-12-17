---
description: Refactor selected code to improve quality while maintaining functionality.
---

# Refactor Code

## Overview

Refactor the selected code to improve its quality while maintaining the same functionality. Focus on code quality, performance, and maintainability.

## User Input

```text
$ARGUMENTS
```

## Steps

1. **Analyze current code**
   - Understand the code's purpose and functionality
   - Identify areas for improvement
   - Note any dependencies or side effects

2. **Code Quality Improvements**
   - Extract reusable functions or components
   - Eliminate code duplication
   - Improve variable and function naming
   - Simplify complex logic and reduce nesting

3. **Performance Optimizations**
   - Identify and fix performance bottlenecks
   - Optimize algorithms and data structures
   - Reduce unnecessary computations
   - Improve memory usage

4. **Maintainability**
   - Make the code more readable and self-documenting
   - Add appropriate comments where needed
   - Follow SOLID principles and design patterns
   - Improve error handling and edge case coverage

5. **Validate changes**
   - Ensure functionality is preserved
   - Run existing tests to verify no regressions
   - Check that code follows project conventions

6. **Call Historian** (GOVERNANCE):
   - Read `.opencode/agent/historian.md`
   - Create changelog entry for refactoring work
   - Include: files refactored, improvements made, patterns applied

## Refactoring Checklist

- [ ] Code functionality preserved
- [ ] Duplication eliminated
- [ ] Naming improved
- [ ] Complexity reduced
- [ ] Error handling improved
- [ ] Tests still passing

## References

- Historian: `.opencode/agent/historian.md`
- Code Standards: `.cursor/rules/04-standards/`
