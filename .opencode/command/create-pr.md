---
description: Create a well-structured pull request with proper description, labels, and reviewers.
---

# Create PR

## Overview

Create a well-structured pull request with proper description, labels, and reviewers. Links to related Linear issues automatically.

## User Input

```text
$ARGUMENTS
```

## Steps

1. **Prepare branch**
   - Ensure all changes are committed
   - Push branch to remote
   - Verify branch is up to date with main

2. **Gather context**
   - Read spec folder for feature context (if exists)
   - Get Linear issue ID from branch name
   - Collect list of changed files

3. **Write PR description**
   - Summarize changes clearly
   - Include context and motivation
   - List any breaking changes
   - Add screenshots if UI changes
   - Link related Linear issues

4. **Set up PR**
   - Create PR with descriptive title
   - Add appropriate labels
   - Assign reviewers
   - Link related issues

5. **Call Historian** (GOVERNANCE):
   - Read `.opencode/agent/historian.md`
   - Create changelog entry for PR creation
   - Include: PR URL, linked issues, summary

## PR Template

```markdown
## Summary

{Brief description of changes}

## Changes

- {Change 1}
- {Change 2}

## Testing

- [ ] Unit tests pass
- [ ] Manual testing completed

## Linear Issue

Closes {LINEAR-ID}
```

## Checklist

- [ ] Feature complete
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No breaking changes (or documented)

## References

- Historian: `.opencode/agent/historian.md`
