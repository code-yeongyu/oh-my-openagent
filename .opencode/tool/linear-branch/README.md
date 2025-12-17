# Linear Branch Tool

Get the git branch name for a Linear issue to ensure consistent branch naming.

## Usage

```typescript
// Called by agent with:
{
  issueId: "ABC-123"  // or UUID format
}

// Returns:
{
  success: true,
  branchName: "eru/abc-123-implement-user-auth",
  generated: false,  // true if branch name was generated
  issueTitle: "Implement user authentication",
  issueUrl: "https://linear.app/team/issue/ABC-123",
  issueIdentifier: "ABC-123"
}
```

## Features

- Retrieves branch name from Linear issue
- Generates fallback branch name if Linear doesn't have one
- Validates issue ID format (TEAM-123 or UUID)
- Provides helpful error messages

## Requirements

- Linear MCP configured in `opencode.json`
- `LINEAR_API_KEY` environment variable set

## Testing

```bash
npx tsx __tests__/linear-branch.test.ts
```

