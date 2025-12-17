# Linear Update Status Tool

Update the status of a Linear issue with an optional comment.

## Usage

```typescript
// Called by agent with:
{
  issueId: "ABC-123",
  status: "in_progress",  // todo | in_progress | in_review | done | canceled
  comment: "Started working on this"  // optional
}

// Returns:
{
  success: true,
  issueId: "ABC-123",
  newStatus: "in_progress",
  commentAdded: true,
  message: "Issue ABC-123 updated to 'In Progress' with comment"
}
```

## Status Values

| Input | Linear State |
|-------|--------------|
| `todo` | Todo |
| `in_progress` | In Progress |
| `in_review` | In Review |
| `done` | Done |
| `canceled` | Canceled |

## Features

- Updates issue status via Linear API
- Optionally adds a comment with the status change
- Validates issue ID and status values
- Provides helpful error messages with suggestions

## Requirements

- Linear MCP configured in `opencode.json`
- `LINEAR_API_KEY` environment variable set

## Testing

```bash
npx tsx __tests__/linear-update-status.test.ts
```

