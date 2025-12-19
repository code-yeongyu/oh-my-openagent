# LIF-58: Implementation Plan

**Linear Issue**: [LIF-58](https://linear.app/lifelogger/issue/LIF-58)
**Created**: 2025-12-17
**Author**: Orchestrator

## Architecture

This is a **prompt-only change** to `src/agents/omo.ts`. No new code, hooks, or tools required.

### Component: OmO System Prompt

Add new `<Spec_Workflow>` section to OmO's system prompt that teaches:
1. How to detect spec folders
2. How to read and parse tasks.md
3. How to convert tasks to todos
4. When to use spec workflow vs direct todos

## Implementation Approach

### Phase 1: Spec Folder Detection Logic

Add instructions for OmO to detect spec folders:

```markdown
<Spec_Workflow>
## Spec-Driven Todo Creation

When working on a feature with a spec folder:

### Step 1: Detect Spec Folder
If user mentions Linear issue (e.g., LIF-123) or feature name:
1. Check if `.cursor/specs/{ISSUE-ID}-*` or `context/specs/{ISSUE-ID}-*` exists
2. If exists, read `tasks.md` for task breakdown
3. If not exists, use standard todo workflow
```

### Phase 2: Tasks.md Parsing

Add instructions for parsing tasks.md table format:

```markdown
### Step 2: Parse Tasks.md
Read tasks.md table:
| ID | Task | Status | Estimate |
|----|------|--------|----------|
| 1 | Implement auth service | Not Started | 2h |
| 2 | Add login endpoint | Not Started | 1h |

Extract:
- Task ID (for todo ID)
- Task description (for todo content)
- Status (skip if "Done")
- Estimate (for prioritization)
```

### Phase 3: Todo Conversion

Add instructions for converting tasks to todos:

```markdown
### Step 3: Convert Tasks to Todos
Create todos from tasks:
todowrite([
  {id: "task-1", content: "Implement auth service (from tasks.md #1)", status: "pending"},
  {id: "task-2", content: "Add login endpoint (from tasks.md #2)", status: "pending"}
])

Rules:
- Skip tasks with Status = "Done"
- Include source reference in content
- Use task ID as todo ID prefix
```

### Phase 4: Execution & Status Updates

Add instructions for execution and optional status updates:

```markdown
### Step 4: Execute with Evidence
For each todo:
1. Mark `in_progress`
2. Do the work
3. Gather evidence (lsp_diagnostics, tests, etc.)
4. Mark `completed` with evidence

### Step 5: Update Spec (Optional)
After completing tasks, update tasks.md status column:
- "Not Started" → "Done"
- Add completion date
```

## Data Flow

```
User mentions "LIF-123" or "work on auth feature"
    ↓
OmO checks: Does .cursor/specs/LIF-123-* exist?
    ↓
YES → Read tasks.md → Parse table → Create todos → Execute
    ↓
NO → Standard todo workflow (create todos from scratch)
```

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Malformed tasks.md | Medium | Low | Graceful fallback to standard workflow |
| Large task lists | Low | Medium | Warn user, suggest breaking into phases |
| Stale tasks.md | Medium | Low | Always re-read on session start |

## Testing Strategy

1. **Manual Testing**:
   - Test with existing LIF-57 spec folder
   - Test with non-existent spec folder (fallback)
   - Test with malformed tasks.md

2. **Acceptance Testing**:
   - Verify todos created from tasks.md
   - Verify source references in todos
   - Verify resume capability

## Rollback Strategy

If issues arise:
1. Remove `<Spec_Workflow>` section from OmO prompt
2. OmO reverts to standard todo-only workflow
3. No data loss (spec folders unchanged)
