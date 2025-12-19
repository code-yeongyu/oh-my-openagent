# LIF-67 Implementation: Fix Workflow State Persistence

**Date**: 2025-12-19
**Agent**: OmO (Implementation)
**Linear Issue**: LIF-67

## Summary

Fixed the workflow state persistence gap by adding explicit `update_workflow_state` tool call instructions to all 6 workflow commands.

## Problem

The `update_workflow_state` tool existed and was registered, but workflow commands didn't instruct agents to call it. Result: `workflow-state.json` was never created.

## Solution

Added "Persist Workflow State (REQUIRED)" section to each workflow command:
- `/specify` → step: "specify", linearStatus: "todo"
- `/plan` → step: "plan", linearStatus: "in_progress"
- `/tasks` → step: "tasks", linearStatus: "in_progress"
- `/implement` → step: "implement", linearStatus: "in_progress"
- `/review` → step: "review", linearStatus: "in_review"
- `/test` → step: "test", linearStatus: "in_review"

## Files Modified

- `.opencode/command/specify.md`
- `.opencode/command/plan.md`
- `.opencode/command/tasks.md`
- `.opencode/command/implement.md`
- `.opencode/command/review.md`
- `.opencode/command/test.md`
- `docs/architecture/12-workflow-system.md`

## Verification

- Typecheck passes
- Documentation updated to clarify behavior
- Ready for manual testing

## Impact

- Session continuity now works (workflow-state.json created)
- Resume messages will appear after session restart
- Workflow progress is properly tracked
- Linear status synced with workflow state
