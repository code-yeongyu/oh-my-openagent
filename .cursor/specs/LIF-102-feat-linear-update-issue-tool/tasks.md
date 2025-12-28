# LIF-102 Task Breakdown

**Linear Issue**: [LIF-102](https://linear.app/lifelogger/issue/LIF-102/extend-linear-tooling-with-comprehensive-issue-update-capability)
**Created**: 2025-12-28
**Total Estimate**: 3.5h

## Summary

| Phase | Tasks | Estimate | Status |
|-------|-------|----------|--------|
| Phase 1: Types and Constants | 6 tasks | 30min | Not Started |
| Phase 2: API Layer | 4 tasks | 1h | Not Started |
| Phase 3: Tool Implementation | 6 tasks | 1.5h | Not Started |
| Phase 4: Integration | 3 tasks | 30min | Not Started |
| **Total** | **19 tasks** | **3.5h** | - |

---

## Phase 1: Types and Constants (30min)

**Goal**: Define all TypeScript types and constants needed for the update issue tool.

| ID | Task | Status | Estimate | Dependencies | US | Notes |
|----|------|--------|----------|--------------|-----|-------|
| T1.1 | Add `LinearPriority` type union | Not Started | 5min | - | US-3 | `0 \| 1 \| 2 \| 3 \| 4 \| "urgent" \| "high" \| "medium" \| "low" \| "none"` |
| T1.2 | Add `LinearLabelOperations` interface | Not Started | 5min | - | US-2 | `{ add?: string[], remove?: string[], set?: string[] }` |
| T1.3 | Add `LinearUpdateIssueInput` interface | Not Started | 5min | T1.1, T1.2 | US-1,2,3,4,5,6 | All optional fields except `issueId` |
| T1.4 | Add `LinearFieldChange` interface | Not Started | 5min | - | US-7 | `{ field: string, from: unknown, to: unknown }` |
| T1.5 | Add `LinearUpdateIssueResult` interface | Not Started | 5min | T1.4 | US-7 | Includes `changes[]`, `currentState`, `message` |
| T1.6 | Add `PRIORITY_MAP` and `PRIORITY_LABELS` constants | Not Started | 5min | - | US-3 | String-to-number and number-to-label mappings |

**Checkpoint**: Run `bun run typecheck` - all types compile without errors.

### Task Details

**T1.1: Add LinearPriority type**
- File: `src/tools/linear/types.ts`
- Add after line 111 (after `STATUS_TO_STATE_TYPE`)
- Type: `export type LinearPriority = 0 | 1 | 2 | 3 | 4 | "urgent" | "high" | "medium" | "low" | "none"`

**T1.2: Add LinearLabelOperations interface**
- File: `src/tools/linear/types.ts`
- Mutually exclusive operations for label management
- JSDoc explaining add/remove/set semantics

**T1.3: Add LinearUpdateIssueInput interface**
- File: `src/tools/linear/types.ts`
- Required: `issueId: string`
- Optional: `title`, `description`, `priority`, `estimate`, `dueDate`, `assigneeId`, `labels`

**T1.4: Add LinearFieldChange interface**
- File: `src/tools/linear/types.ts`
- For tracking what changed: `{ field, from, to }`

**T1.5: Add LinearUpdateIssueResult interface**
- File: `src/tools/linear/types.ts`
- Include: `success`, `issueIdentifier`, `issueUrl`, `changes[]`, `currentState?`, `message`, `error?`, `validationErrors?`

**T1.6: Add priority constants**
- File: `src/tools/linear/constants.ts`
- `PRIORITY_MAP`: `{ none: 0, urgent: 1, high: 2, medium: 3, low: 4 }`
- `PRIORITY_LABELS`: `{ 0: "No priority", 1: "Urgent", 2: "High", 3: "Medium", 4: "Low" }`

---

## Phase 2: API Layer (1h)

**Goal**: Implement GraphQL API functions for issue updates and label resolution.

| ID | Task | Status | Estimate | Dependencies | US | Notes |
|----|------|--------|----------|--------------|-----|-------|
| T2.1 | Add `LinearIssueWithTeam` type | Not Started | 10min | Phase 1 | - | Extended issue type with team and full state |
| T2.2 | Add `getIssueWithTeam()` function | Not Started | 15min | T2.1 | US-7 | Fetch issue + team for label resolution |
| T2.3 | Add `resolveLabelNames()` helper | Not Started | 15min | T2.2 | US-2 | Convert label names to UUIDs |
| T2.4 | Add `updateIssue()` function | Not Started | 20min | T2.2, T2.3 | US-1,2,3,4,5,6 | GraphQL mutation with all fields |

**Checkpoint**: API functions can be imported and called (manual test with mock data).

### Task Details

**T2.1: Add LinearIssueWithTeam type**
- File: `src/tools/linear/api.ts`
- Extends `LinearIssue` with:
  - `priority: number`
  - `priorityLabel: string`
  - `estimate?: number`
  - `dueDate?: string`
  - `assignee?: { id, name, email }`
  - `team: { id, labels: { nodes: [...] } }`

**T2.2: Add getIssueWithTeam() function**
- File: `src/tools/linear/api.ts`
- GraphQL query fetching full issue state + team labels
- Returns `LinearIssueWithTeam` for change tracking

**T2.3: Add resolveLabelNames() helper**
- File: `src/tools/linear/api.ts`
- Input: `teamId: string`, `labelNames: string[]`
- Output: `{ resolved: string[], notFound: string[] }`
- Case-insensitive matching against team + workspace labels

**T2.4: Add updateIssue() function**
- File: `src/tools/linear/api.ts`
- GraphQL mutation: `issueUpdate`
- Supports: `title`, `description`, `priority`, `estimate`, `dueDate`, `assigneeId`, `labelIds`, `addedLabelIds`, `removedLabelIds`
- Returns updated issue state

---

## Phase 3: Tool Implementation (1.5h)

**Goal**: Implement the `linear_update_issue` tool with validation and change tracking.

| ID | Task | Status | Estimate | Dependencies | US | Notes |
|----|------|--------|----------|--------------|-----|-------|
| T3.1 | Add `LINEAR_UPDATE_ISSUE_DESCRIPTION` constant | Not Started | 5min | - | - | Tool description with usage examples |
| T3.2 | Implement `validateLabelOperations()` helper | Not Started | 15min | Phase 1 | US-2 | Check mutual exclusivity of add/remove/set |
| T3.3 | Implement `normalizePriority()` helper | Not Started | 10min | T1.6 | US-3 | Convert string priority to number |
| T3.4 | Implement `buildChangesArray()` helper | Not Started | 20min | T1.4 | US-7 | Compare before/after states |
| T3.5 | Implement `createLinearUpdateIssueTool()` factory | Not Started | 30min | T3.1-T3.4, Phase 2 | All | Main tool implementation |
| T3.6 | Export from `index.ts` | Not Started | 5min | T3.5 | - | Add to barrel exports |

**Checkpoint**: Tool can be instantiated and called with mock input.

### Task Details

**T3.1: Add tool description constant**
- File: `src/tools/linear/constants.ts`
- Multi-line description explaining:
  - All updatable fields
  - Priority formats (numeric and string)
  - Label operation modes
  - Response structure

**T3.2: Implement validateLabelOperations()**
- File: `src/tools/linear/tools.ts`
- Input: `LinearLabelOperations`
- Returns: `{ valid: boolean, error?: string }`
- Rules:
  - Only one of `add`, `remove`, `set` can be used
  - `add` and `remove` can be combined
  - `set` cannot be combined with others

**T3.3: Implement normalizePriority()**
- File: `src/tools/linear/tools.ts`
- Input: `LinearPriority`
- Output: `number` (0-4)
- Uses `PRIORITY_MAP` for string conversion

**T3.4: Implement buildChangesArray()**
- File: `src/tools/linear/tools.ts`
- Input: `before: LinearIssueWithTeam`, `after: LinearIssueWithTeam`, `input: LinearUpdateIssueInput`
- Output: `LinearFieldChange[]`
- Compare only fields that were in input

**T3.5: Implement createLinearUpdateIssueTool()**
- File: `src/tools/linear/tools.ts`
- Schema with all optional fields
- Flow:
  1. Validate input (label ops, priority format)
  2. Fetch current issue state
  3. Resolve label names if needed
  4. Build mutation variables
  5. Execute update
  6. Build changes array
  7. Return result

**T3.6: Export from index.ts**
- File: `src/tools/linear/index.ts`
- Add `createLinearUpdateIssueTool` to exports

---

## Phase 4: Integration (30min)

**Goal**: Register tool in plugin and verify end-to-end functionality.

| ID | Task | Status | Estimate | Dependencies | US | Notes |
|----|------|--------|----------|--------------|-----|-------|
| T4.1 | Add tool to `builtinTools` in main index | Not Started | 10min | Phase 3 | - | Import and register tool factory |
| T4.2 | Manual testing with real Linear workspace | Not Started | 15min | T4.1 | All | Test all field updates |
| T4.3 | Verify error handling for edge cases | Not Started | 5min | T4.2 | - | Invalid IDs, missing labels, etc. |

**Checkpoint**: Tool appears in OpenCode tool list and successfully updates a test issue.

### Task Details

**T4.1: Add to builtinTools**
- File: `src/index.ts`
- Import `createLinearUpdateIssueTool` from `./tools`
- Add to `builtinTools` array alongside other Linear tools

**T4.2: Manual testing checklist**
- [ ] Update title only
- [ ] Update description only
- [ ] Update priority (numeric: 0, 1, 2, 3, 4)
- [ ] Update priority (string: urgent, high, medium, low, none)
- [ ] Update estimate
- [ ] Set due date
- [ ] Clear due date (null)
- [ ] Assign user
- [ ] Unassign user (null)
- [ ] Add single label
- [ ] Add multiple labels
- [ ] Remove single label
- [ ] Remove multiple labels
- [ ] Set labels (replace all)
- [ ] Update multiple fields at once
- [ ] Verify changes array in response

**T4.3: Error case verification**
- [ ] Invalid issue ID returns clear error
- [ ] Invalid priority value returns validation error
- [ ] Non-existent label name returns error with hint
- [ ] Missing LINEAR_API_KEY returns clear error
- [ ] Mixed add/remove with set returns validation error

---

## Dependency Graph

```
Phase 1 (Types & Constants)
├── T1.1 LinearPriority ─────────────────────┐
├── T1.2 LinearLabelOperations ──────────────┤
│                                            ├── T1.3 LinearUpdateIssueInput
├── T1.4 LinearFieldChange ──────────────────┼── T1.5 LinearUpdateIssueResult
└── T1.6 PRIORITY_MAP/LABELS ────────────────┘
                    │
                    ▼
Phase 2 (API Layer)
├── T2.1 LinearIssueWithTeam ────────────────┐
│                                            ├── T2.2 getIssueWithTeam()
│                                            │           │
│                                            │           ▼
│                                            └── T2.3 resolveLabelNames()
│                                                        │
│                                                        ▼
└────────────────────────────────────────────── T2.4 updateIssue()
                    │
                    ▼
Phase 3 (Tool Implementation)
├── T3.1 Description constant
├── T3.2 validateLabelOperations() ──────────┐
├── T3.3 normalizePriority() ────────────────┼── T3.5 createLinearUpdateIssueTool()
├── T3.4 buildChangesArray() ────────────────┘           │
│                                                        ▼
└────────────────────────────────────────────── T3.6 Export from index.ts
                    │
                    ▼
Phase 4 (Integration)
├── T4.1 Add to builtinTools
├── T4.2 Manual testing
└── T4.3 Error verification
```

---

## User Story Mapping

| User Story | Tasks | Coverage |
|------------|-------|----------|
| **US-1**: Update description | T1.3, T2.4, T3.5 | Full |
| **US-2**: Add/remove labels | T1.2, T1.3, T2.3, T3.2, T3.5 | Full |
| **US-3**: Update priority/estimate | T1.1, T1.6, T3.3, T3.5 | Full |
| **US-4**: Update title | T1.3, T2.4, T3.5 | Full |
| **US-5**: Set/clear due date | T1.3, T2.4, T3.5 | Full |
| **US-6**: Assign/unassign | T1.3, T2.4, T3.5 | Full |
| **US-7**: See changes in response | T1.4, T1.5, T2.2, T3.4, T3.5 | Full |

---

## Recommended Execution Order

### Phase 1 (30min)
1. **T1.1** + **T1.2** + **T1.4** (parallel - independent types)
2. **T1.6** (constants - independent)
3. **T1.3** (depends on T1.1, T1.2)
4. **T1.5** (depends on T1.4)
5. Run `bun run typecheck` to verify

### Phase 2 (1h)
1. **T2.1** (type definition)
2. **T2.2** (getIssueWithTeam - needed for change tracking)
3. **T2.3** (resolveLabelNames - needed for label ops)
4. **T2.4** (updateIssue - main mutation)

### Phase 3 (1.5h)
1. **T3.1** (description constant)
2. **T3.2** + **T3.3** (parallel - independent helpers)
3. **T3.4** (buildChangesArray)
4. **T3.5** (main tool - depends on all above)
5. **T3.6** (export)

### Phase 4 (30min)
1. **T4.1** (register tool)
2. **T4.2** (manual testing)
3. **T4.3** (error verification)

---

## Notes

### Implementation Considerations
- Reuse existing `executeQuery()` pattern from `api.ts`
- Follow existing tool factory pattern from `createLinearUpdateStatusTool()`
- Use `log()` from `../../shared/logger` for consistent logging
- All API calls should handle missing `LINEAR_API_KEY` gracefully

### Risks
- Label resolution may fail for workspace-only labels (mitigate: query both team and workspace labels)
- Concurrent updates could cause data loss (document in tool description, defer optimistic locking)
- Priority string normalization must be case-insensitive

### Testing Notes
- No automated tests in this project (per AGENTS.md)
- Manual testing against real Linear workspace required
- Use a test issue to avoid polluting real project data

### Files Modified Summary
| File | Lines Added (est.) | Changes |
|------|-------------------|---------|
| `src/tools/linear/types.ts` | ~60 | 5 new types/interfaces |
| `src/tools/linear/constants.ts` | ~30 | 3 new constants |
| `src/tools/linear/api.ts` | ~100 | 3 new functions + 1 type |
| `src/tools/linear/tools.ts` | ~150 | 1 tool factory + 3 helpers |
| `src/tools/linear/index.ts` | ~2 | 1 new export |
| `src/index.ts` | ~2 | 1 new import + registration |
