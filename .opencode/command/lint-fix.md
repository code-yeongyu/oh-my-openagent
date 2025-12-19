---
category: quality
description: Analyze code for linting issues and automatically fix them.
---

# Lint and Fix Code

## Overview

Analyze the current file for linting issues and automatically fix them according to the project's coding standards.

## User Input

```text
$ARGUMENTS
```

## Steps

1. **Analyze code**
   - Identify the file type and applicable linting rules
   - Check project configuration for linting settings
   - Scan for issues

2. **Identify issues**
   - Code formatting and style consistency
   - Unused imports and variables
   - Missing semicolons or proper indentation
   - Best practice violations
   - Type safety issues

3. **Apply fixes**
   - Fix formatting issues
   - Remove unused imports/variables
   - Correct indentation
   - Apply best practices
   - Fix type issues where possible

4. **Validate changes**
   - Ensure code still compiles/runs
   - Verify no functionality changed
   - Run linter to confirm issues resolved

5. **Report changes**
   - Explain what changes were made
   - Note any issues that couldn't be auto-fixed
   - Suggest manual fixes if needed

## Linting Checklist

- [ ] Formatting consistent
- [ ] Unused imports removed
- [ ] Indentation correct
- [ ] Best practices followed
- [ ] Type issues resolved
- [ ] Code still functional

## References

- Code Standards: `.cursor/rules/04-standards/`
