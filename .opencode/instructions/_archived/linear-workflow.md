# Linear Workflow Integration

> Standard workflow for Linear integration across all agents.

## Branch Naming

### Getting Branch Name from Linear

When starting work on an issue:
1. Use `linear_get_issue` to retrieve issue details
2. Branch name is in `issue.branchName` field
3. Use exact branch name from Linear

### Branch Format

Linear generates branches as:
```
{username}/{issue-id}-{issue-title-slug}
```

Example: `eru/abc-123-implement-user-auth`

## Issue Lifecycle

### Status Flow

```
Backlog → Todo → In Progress → In Review → Done
                      ↓              ↓
                   Blocked        Canceled
```

### When to Update Status

| Action | Status Change |
|--------|---------------|
| Start working | Todo → In Progress |
| Open PR | In Progress → In Review |
| PR merged | In Review → Done |
| Blocked | → Blocked (add blocker comment) |
| Abandoned | → Canceled (add reason) |

## Labels

### Standard Labels to Apply

- `type:bug` - Bug fixes
- `type:feature` - New features
- `type:docs` - Documentation
- `type:refactor` - Refactoring
- `type:infra` - Infrastructure
- `priority:urgent` - Urgent items
- `priority:high` - High priority
- `priority:low` - Low priority

## Comments

### Progress Updates

For tasks > 4 hours, post progress comments:

```markdown
## Progress Update - {Date}

**Status**: {In Progress | Blocked | Completing}

### Completed
- {item 1}
- {item 2}

### In Progress
- {current work}

### Blockers
- {any blockers}

### Next Steps
- {planned work}
```

### Completion Summary

When completing an issue:

```markdown
## Completion Summary

### What was done
- {change 1}
- {change 2}

### Files Changed
- `path/to/file1.ts`
- `path/to/file2.ts`

### Testing
- {how it was tested}

### Documentation
- {links to docs if created}

### PR
- {link to PR}
```

## Creating Issues

### Issue Template

When creating new issues:

**Title**: Clear, action-oriented

- Good: "Implement user authentication with OAuth2"
- Bad: "Auth stuff"

**Description**:

```markdown
## Summary
{1-2 sentence description}

## Background
{Why this is needed}

## Requirements
- [ ] Requirement 1
- [ ] Requirement 2

## Acceptance Criteria
- [ ] Criteria 1
- [ ] Criteria 2

## Technical Notes
{Any technical considerations}
```

