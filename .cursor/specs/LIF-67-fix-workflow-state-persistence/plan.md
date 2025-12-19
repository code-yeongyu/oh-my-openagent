# Fix Workflow State Persistence - Implementation Plan

**Linear Issue**: [LIF-67](https://linear.app/lifelogger/issue/LIF-67)
**Created**: 2025-12-19
**Author**: Strategic Architect

## Summary

Add explicit `update_workflow_state` tool call instructions to 6 workflow commands. This is a **documentation-only fix** - no code changes required. The tool already exists and works; commands just need to tell agents to call it.

## Technical Context

| Aspect | Details |
|--------|---------|
| **Type** | Documentation fix (markdown only) |
| **Language** | Markdown |
| **Dependencies** | None - tool already implemented |
| **Testing** | Manual verification via workflow execution |
| **Risk** | Very low - additive changes only |

## Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| Plugin-First | ✅ N/A | No plugin code changes |
| Bun-Native | ✅ N/A | No package changes |
| Hook-Driven | ✅ N/A | No hook changes |
| GitHub Actions Only | ✅ N/A | No publishing involved |

## Architecture

### Current State (Broken)

```
User runs /plan
    ↓
commandPreflight() validates prerequisites ✓
    ↓
Command executes, creates plan.md ✓
    ↓
Command completes
    ↓
NO call to update_workflow_state ✗
    ↓
workflow-state.json NOT created ✗
```

### Target State (Fixed)

```
User runs /plan
    ↓
commandPreflight() validates prerequisites ✓
    ↓
Command executes, creates plan.md ✓
    ↓
Command instructs agent to call update_workflow_state ✓
    ↓
Agent calls: update_workflow_state({ specPath, step: "plan", linearStatus: "in_progress" })
    ↓
workflow-state.json CREATED ✓
```

## Implementation Approach

### Strategy: Surgical Addition

Add a new section to each workflow command after the final step, instructing agents to persist workflow state. The section format:

```markdown
## Workflow State Persistence

**REQUIRED**: After completing this command, persist workflow state:

\`\`\`
update_workflow_state({
  specPath: "{SPEC_DIR}",
  step: "{STEP}",
  linearStatus: "{STATUS}"
})
\`\`\`

This enables session continuity and resume messages.
```

### Command-Specific Parameters

| Command | step | linearStatus | Insert After |
|---------|------|--------------|--------------|
| `/specify` | "specify" | "todo" | Step 7 (Report completion) |
| `/plan` | "plan" | "in_progress" | Step 7 (Report completion) |
| `/tasks` | "tasks" | "in_progress" | Step 6 (Report completion) |
| `/implement` | "implement" | "in_progress" | Step 5 (Report completion) |
| `/review` | "review" | "in_review" | Step 6 (Report completion) |
| `/test` | "test" | "in_review" | Step 6 (Report completion) |

## File Changes

### 1. `.opencode/command/specify.md`

**Location**: After line ~95 (after "Report completion" step)

**Add**:
```markdown
8. **Persist Workflow State** (REQUIRED):
   ```
   update_workflow_state({
     specPath: "{SPEC_DIR}",
     step: "specify",
     linearStatus: "todo"
   })
   ```
   This enables session continuity and resume messages.
```

### 2. `.opencode/command/plan.md`

**Location**: After line ~66 (after "Report completion" step)

**Add**:
```markdown
8. **Persist Workflow State** (REQUIRED):
   ```
   update_workflow_state({
     specPath: "{SPEC_DIR}",
     step: "plan",
     linearStatus: "in_progress"
   })
   ```
   This enables session continuity and resume messages.
```

### 3. `.opencode/command/tasks.md`

**Location**: After line ~57 (after "Report completion" step)

**Add**:
```markdown
7. **Persist Workflow State** (REQUIRED):
   ```
   update_workflow_state({
     specPath: "{SPEC_DIR}",
     step: "tasks",
     linearStatus: "in_progress"
   })
   ```
   This enables session continuity and resume messages.
```

### 4. `.opencode/command/implement.md`

**Location**: After line ~60 (after "Report completion" step)

**Add**:
```markdown
6. **Persist Workflow State** (REQUIRED):
   ```
   update_workflow_state({
     specPath: "{SPEC_DIR}",
     step: "implement",
     linearStatus: "in_progress"
   })
   ```
   This enables session continuity and resume messages.
```

### 5. `.opencode/command/review.md`

**Location**: After line ~53 (after "Report completion" step)

**Add**:
```markdown
7. **Persist Workflow State** (REQUIRED):
   ```
   update_workflow_state({
     specPath: "{SPEC_DIR}",
     step: "review",
     linearStatus: "in_review"
   })
   ```
   This enables session continuity and resume messages.
```

### 6. `.opencode/command/test.md`

**Location**: After line ~54 (after "Report completion" step)

**Add**:
```markdown
7. **Persist Workflow State** (REQUIRED):
   ```
   update_workflow_state({
     specPath: "{SPEC_DIR}",
     step: "test",
     linearStatus: "in_review"
   })
   ```
   This enables session continuity and resume messages.
```

## Verification Plan

### Manual Testing

1. Create test spec folder:
   ```bash
   create_spec_folder({ featureName: "test-workflow", linearIssue: "TEST-001", type: "feat" })
   ```

2. Run `/plan` command on the spec folder

3. Verify `workflow-state.json` created:
   ```bash
   cat .cursor/specs/TEST-001-feat-test-workflow/workflow-state.json
   ```

4. Expected content:
   ```json
   {
     "currentStep": "plan",
     "completedSteps": [],
     "artifactHashes": { "spec.md": "...", "plan.md": "..." },
     "linearIssueId": "TEST-001",
     "linearStatus": "in_progress",
     "createdAt": "2025-12-19T...",
     "updatedAt": "2025-12-19T...",
     "lastCommand": "/plan"
   }
   ```

### Build Verification

```bash
bun run typecheck  # Should pass (no code changes)
bun run build      # Should pass
```

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Agent ignores instructions | Low | Medium | Use strong directive language ("REQUIRED") |
| Wrong step/status values | Low | Low | Double-check frontmatter values |
| Formatting breaks command | Very Low | Low | Test each command after edit |

## Estimate

| Task | Time |
|------|------|
| Edit 6 command files | 15 min |
| Manual verification | 10 min |
| Build verification | 5 min |
| **Total** | ~30 min |

## Success Criteria

- [ ] All 6 workflow commands have state persistence instructions
- [ ] Instructions use correct step and linearStatus values
- [ ] Build passes
- [ ] `/plan` command creates `workflow-state.json`
- [ ] State file contains correct structure

## References

- **Tool**: `src/tools/spec/tools.ts` (updateWorkflowStateTool)
- **State logic**: `src/shared/workflow-context.ts`
- **Spec**: `.cursor/specs/LIF-67-fix-workflow-state-persistence/spec.md`
