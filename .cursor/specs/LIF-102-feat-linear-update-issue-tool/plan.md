# Comprehensive Linear Issue Update Tool - Implementation Plan

**Linear Issue**: [LIF-102](https://linear.app/lifelogger/issue/LIF-102/extend-linear-tooling-with-comprehensive-issue-update-capability)
**Created**: 2025-12-28
**Author**: Strategic Planner (OmO)

## Summary

Add a `linear_update_issue` tool that enables AI agents to comprehensively update Linear issue fields (title, description, priority, estimate, due date, assignee, labels) through a single unified interface with partial-update semantics. The implementation follows existing patterns in `src/tools/linear/` and reuses the established GraphQL infrastructure.

## Technical Context

| Aspect | Details |
|--------|---------|
| **Language** | TypeScript 5.7+ |
| **Runtime** | Bun >= 1.0.0 |
| **Framework** | @opencode-ai/plugin SDK |
| **Target Directory** | `src/tools/linear/` |
| **Package Manager** | Bun only |
| **Existing Tools** | 6 Linear tools (branch, update_status, create_issue, archive_issue, get_issue, add_comment) |

## Constitution Check

| Principle | Compliance |
|-----------|------------|
| Plugin-First Architecture | ✅ Uses @opencode-ai/plugin tool() factory |
| Bun-Native Development | ✅ Bun runtime, no npm/yarn |
| Hook-Driven Enhancement | ⚠️ N/A - This is a tool, not a hook |
| Multi-Model Excellence | ✅ Tool available to all agents |

## Architecture

### Component Diagram
```
┌─────────────────────────────────────────────────────────────────┐
│                     src/tools/linear/                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐     ┌──────────────────────────────────┐   │
│  │   tools.ts      │     │           api.ts                 │   │
│  │                 │     │                                  │   │
│  │ createLinear... │────▶│ updateIssue()      [NEW]         │   │
│  │ UpdateIssueTool │     │ resolveLabels()    [NEW]         │   │
│  │      [NEW]      │     │ executeQuery()     [EXISTS]      │   │
│  └────────┬────────┘     │ getIssue()         [EXISTS]      │   │
│           │              └──────────────────────────────────┘   │
│           │                                                      │
│  ┌────────▼────────┐     ┌──────────────────────────────────┐   │
│  │   types.ts      │     │         constants.ts              │   │
│  │                 │     │                                  │   │
│  │ LinearUpdate... │     │ LINEAR_UPDATE_ISSUE_DESCRIPTION  │   │
│  │ IssueInput      │     │      [NEW]                       │   │
│  │      [NEW]      │     │                                  │   │
│  │ LinearUpdate... │     │ PRIORITY_MAP                     │   │
│  │ IssueResult     │     │      [NEW]                       │   │
│  │      [NEW]      │     │                                  │   │
│  └─────────────────┘     └──────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────┐                                            │
│  │   index.ts      │                                            │
│  │                 │                                            │
│  │ export create.. │                                            │
│  │ LinearUpdate... │                                            │
│  │ IssueTool       │                                            │
│  │      [NEW]      │                                            │
│  └─────────────────┘                                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow
```
1. Agent calls linear_update_issue with partial fields
                    ↓
2. Tool validates input (mutually exclusive label ops, priority format)
                    ↓
3. Fetch current issue state (for change tracking)
                    ↓
4. Resolve label names → UUIDs (reuse label resolution from createIssue)
                    ↓
5. Build GraphQL mutation variables (only provided fields)
                    ↓
6. Execute issueUpdate mutation via executeQuery()
                    ↓
7. Build response with changes array (field, from, to)
                    ↓
8. Return JSON result to agent
```

## Data Models

### Input Types

```typescript
/**
 * Priority values - support both numeric and string formats
 */
export type LinearPriority = 0 | 1 | 2 | 3 | 4 | "urgent" | "high" | "medium" | "low" | "none"

/**
 * Label operation modes - mutually exclusive
 */
export interface LinearLabelOperations {
  /** Add labels to existing labels */
  add?: string[]
  /** Remove labels from existing labels */
  remove?: string[]
  /** Replace all labels with this set */
  set?: string[]
}

/**
 * Input for linear_update_issue tool
 * All fields are optional - only provided fields are updated
 */
export interface LinearUpdateIssueInput {
  /** Issue identifier (e.g., "LIF-123") or UUID */
  issueId: string
  /** New title */
  title?: string
  /** New description (Markdown supported) */
  description?: string
  /** Priority: 0-4 or "urgent"/"high"/"medium"/"low"/"none" */
  priority?: LinearPriority
  /** Story point estimate */
  estimate?: number
  /** Due date in YYYY-MM-DD format, or null to clear */
  dueDate?: string | null
  /** Assignee user ID (UUID), or null to unassign */
  assigneeId?: string | null
  /** Label operations - add, remove, or set (mutually exclusive) */
  labels?: LinearLabelOperations
}
```

### Result Types

```typescript
/**
 * Single field change record
 */
export interface LinearFieldChange {
  /** Field name that was changed */
  field: string
  /** Previous value (null if not set) */
  from: unknown
  /** New value */
  to: unknown
}

/**
 * Current issue state after update
 */
export interface LinearIssueState {
  id: string
  identifier: string
  title: string
  description?: string
  priority: number
  priorityLabel: string
  estimate?: number
  dueDate?: string
  assignee?: {
    id: string
    name: string
    email: string
  }
  labels: string[]
  url: string
}

/**
 * Result from linear_update_issue tool
 */
export interface LinearUpdateIssueResult {
  /** Whether the operation succeeded */
  success: boolean
  /** Issue identifier (e.g., "LIF-123") */
  issueIdentifier: string
  /** Issue URL */
  issueUrl: string
  /** Array of changes made */
  changes: LinearFieldChange[]
  /** Current issue state after update */
  currentState?: LinearIssueState
  /** Human-readable success message */
  message: string
  /** Error message if failed */
  error?: string
  /** Validation errors if input was invalid */
  validationErrors?: string[]
}
```

### Constants

```typescript
/**
 * Map string priority names to numeric values
 */
export const PRIORITY_MAP: Record<string, number> = {
  none: 0,
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
}

/**
 * Map numeric priority to labels
 */
export const PRIORITY_LABELS: Record<number, string> = {
  0: "No priority",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
}

/**
 * Description for linear_update_issue tool
 */
export const LINEAR_UPDATE_ISSUE_DESCRIPTION = `Comprehensively update a Linear issue's fields.

Use this to update any combination of:
- title: New issue title
- description: New description (Markdown supported)
- priority: 0-4 or "urgent"/"high"/"medium"/"low"/"none"
- estimate: Story point estimate (number)
- dueDate: "YYYY-MM-DD" or null to clear
- assigneeId: User UUID or null to unassign
- labels: { add?: [...], remove?: [...], set?: [...] } (mutually exclusive)

Only provided fields are modified (partial update semantics).

Returns:
- changes: Array of { field, from, to } showing what changed
- currentState: Full issue state after update
- message: Human-readable summary

Note: For status changes, use linear_update_status instead.`
```

## API Design

### GraphQL Mutation

```graphql
mutation UpdateIssue(
  $id: String!
  $title: String
  $description: String
  $priority: Int
  $estimate: Int
  $dueDate: TimelessDate
  $assigneeId: String
  $labelIds: [String!]
  $addedLabelIds: [String!]
  $removedLabelIds: [String!]
) {
  issueUpdate(
    id: $id
    input: {
      title: $title
      description: $description
      priority: $priority
      estimate: $estimate
      dueDate: $dueDate
      assigneeId: $assigneeId
      labelIds: $labelIds
      addedLabelIds: $addedLabelIds
      removedLabelIds: $removedLabelIds
    }
  ) {
    success
    issue {
      id
      identifier
      title
      description
      priority
      priorityLabel
      estimate
      dueDate
      url
      assignee {
        id
        name
        email
      }
      labels {
        nodes {
          id
          name
        }
      }
    }
  }
}
```

### Label Resolution Query

Reuse the pattern from `createIssue` in api.ts:

```graphql
query GetLabelsForTeam($teamId: String!) {
  team(id: $teamId) {
    labels {
      nodes {
        id
        name
      }
    }
  }
  issueLabels {
    nodes {
      id
      name
    }
  }
}
```

## Implementation Steps

### Phase 1: Types and Constants (30min)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 1.1 | Add `LinearPriority` type | `types.ts` | 5min |
| 1.2 | Add `LinearLabelOperations` interface | `types.ts` | 5min |
| 1.3 | Add `LinearUpdateIssueInput` interface | `types.ts` | 5min |
| 1.4 | Add `LinearFieldChange` interface | `types.ts` | 5min |
| 1.5 | Add `LinearUpdateIssueResult` interface | `types.ts` | 5min |
| 1.6 | Add `PRIORITY_MAP`, `PRIORITY_LABELS` | `constants.ts` | 5min |

### Phase 2: API Layer (1h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 2.1 | Add `getIssueWithTeam()` function to fetch issue + team for label resolution | `api.ts` | 15min |
| 2.2 | Add `resolveLabelNames()` helper to convert label names → UUIDs | `api.ts` | 15min |
| 2.3 | Add `updateIssue()` function with GraphQL mutation | `api.ts` | 20min |
| 2.4 | Add `LinearIssueWithTeam` type for extended issue data | `api.ts` | 10min |

### Phase 3: Tool Implementation (1.5h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 3.1 | Add `LINEAR_UPDATE_ISSUE_DESCRIPTION` | `constants.ts` | 5min |
| 3.2 | Implement input validation (label op exclusivity, priority format) | `tools.ts` | 20min |
| 3.3 | Implement `normalizePriority()` helper | `tools.ts` | 10min |
| 3.4 | Implement change tracking (compare before/after) | `tools.ts` | 20min |
| 3.5 | Implement `createLinearUpdateIssueTool()` factory | `tools.ts` | 30min |
| 3.6 | Export from `index.ts` | `index.ts` | 5min |

### Phase 4: Integration (30min)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 4.1 | Add tool to `builtinTools` in main index | `src/index.ts` | 10min |
| 4.2 | Test with real Linear workspace | manual | 15min |
| 4.3 | Verify error handling for edge cases | manual | 5min |

## File Changes

### Files to Modify

| File | Changes |
|------|---------|
| `src/tools/linear/types.ts` | Add 5 new interfaces/types |
| `src/tools/linear/constants.ts` | Add 3 new constants |
| `src/tools/linear/api.ts` | Add 3 new functions |
| `src/tools/linear/tools.ts` | Add 1 new tool factory + 2 helpers |
| `src/tools/linear/index.ts` | Add export for new tool |
| `src/index.ts` | Add tool to builtinTools array |

### No New Files

All changes fit within existing file structure.

## Dependencies

### Internal (This Repo)

| Dependency | Status | Notes |
|------------|--------|-------|
| `src/tools/linear/api.ts` → `executeQuery()` | Exists | Reuse for GraphQL calls |
| `src/tools/linear/api.ts` → `getIssue()` | Exists | Get current state for change tracking |
| `src/tools/linear/api.ts` → label resolution pattern | Exists | From `createIssue()` |
| `src/shared/logger.ts` → `log()` | Exists | For debug logging |
| `@opencode-ai/plugin` → `tool()`, `tool.schema` | Exists | Tool factory |

### External

| Dependency | Status | Notes |
|------------|--------|-------|
| Linear GraphQL API | Required | `issueUpdate` mutation |
| `LINEAR_API_KEY` env var | Required | Authentication |

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Label name resolution fails for non-existent labels | Medium | Low | Return clear error with available labels hint |
| Assignee ID validation - invalid UUID | Medium | Low | Let Linear API return error, pass through to user |
| Priority out of range (not 0-4) | Low | Low | Validate and normalize before API call |
| Concurrent updates causing data loss | Low | Medium | Document in tool description; defer optimistic locking |
| Label op exclusivity not enforced | Low | Medium | Validate before API call, return validation error |
| Missing team context for label resolution | Low | Medium | Fetch issue first to get team ID |

## Testing Strategy

### Manual Testing Checklist

1. **Basic Updates**
   - [ ] Update title only
   - [ ] Update description only
   - [ ] Update priority (numeric: 0, 1, 2, 3, 4)
   - [ ] Update priority (string: urgent, high, medium, low, none)
   - [ ] Update estimate
   - [ ] Set due date
   - [ ] Clear due date (null)
   - [ ] Assign user
   - [ ] Unassign user (null)

2. **Label Operations**
   - [ ] Add single label
   - [ ] Add multiple labels
   - [ ] Remove single label
   - [ ] Remove multiple labels
   - [ ] Set labels (replace all)
   - [ ] Mixed add/remove in same call (should error)
   - [ ] Set + add in same call (should error)

3. **Partial Updates**
   - [ ] Update multiple fields at once
   - [ ] Verify unchanged fields remain unchanged

4. **Error Cases**
   - [ ] Invalid issue ID
   - [ ] Invalid priority value
   - [ ] Non-existent label name
   - [ ] Missing LINEAR_API_KEY
   - [ ] Invalid assignee ID

5. **Response Verification**
   - [ ] Changes array shows correct from/to values
   - [ ] CurrentState reflects updated values
   - [ ] Message is human-readable

### Integration Test (Future)

```typescript
// Example test case structure
describe("linear_update_issue", () => {
  it("should update title and return changes", async () => {
    const result = await updateIssue({
      issueId: "LIF-TEST-123",
      title: "New Title"
    })
    expect(result.success).toBe(true)
    expect(result.changes).toContainEqual({
      field: "title",
      from: "Old Title",
      to: "New Title"
    })
  })
})
```

## Success Metrics

| Metric | Target |
|--------|--------|
| All spec user stories satisfied | 7/7 |
| All functional requirements met | FR-1 through FR-7 |
| Error cases return actionable messages | 100% |
| Follows existing code patterns | 100% |
| No new dependencies added | 0 new packages |

## Time Summary

| Phase | Estimate |
|-------|----------|
| Phase 1: Types and Constants | 30min |
| Phase 2: API Layer | 1h |
| Phase 3: Tool Implementation | 1.5h |
| Phase 4: Integration | 30min |
| **Total** | **3.5h** |

## Technical Decisions

### TD-1: Reuse Label Resolution
Reuse the label resolution pattern from `createIssue()` rather than creating a separate utility. The logic is:
1. Get team ID from issue
2. Query team labels + workspace labels
3. Match names case-insensitively
4. Return UUIDs

### TD-2: Change Tracking Strategy
Fetch issue state before update, then compare with response. This adds one extra API call but provides accurate "from" values for the changes array.

### TD-3: Priority Normalization
Accept both formats and normalize to integer internally:
```typescript
function normalizePriority(priority: LinearPriority): number {
  if (typeof priority === "number") return priority
  return PRIORITY_MAP[priority.toLowerCase()] ?? 0
}
```

### TD-4: Validation Before API Call
Validate input locally before making API call to provide faster, more specific error messages. This includes:
- Label operation exclusivity check
- Priority range/format validation
- Date format validation (YYYY-MM-DD)

## Next Steps

After plan approval:
1. Run `/tasks` to create task breakdown
2. Run `/implement` to start Phase 1
