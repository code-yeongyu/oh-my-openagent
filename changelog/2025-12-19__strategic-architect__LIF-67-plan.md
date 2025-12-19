# LIF-67 Implementation Plan: Fix Workflow State Persistence

**Date**: 2025-12-19
**Agent**: Strategic Architect
**Linear Issue**: LIF-67

## Summary

Created implementation plan for fixing the workflow state persistence gap.

## Approach

**Surgical Documentation Fix** - Add state persistence instructions to 6 workflow commands:
- `/specify` → step: "specify", linearStatus: "todo"
- `/plan` → step: "plan", linearStatus: "in_progress"
- `/tasks` → step: "tasks", linearStatus: "in_progress"
- `/implement` → step: "implement", linearStatus: "in_progress"
- `/review` → step: "review", linearStatus: "in_review"
- `/test` → step: "test", linearStatus: "in_review"

## Key Decisions

1. **No code changes required** - Tool already exists and works
2. **Additive only** - Just append new section to each command
3. **Strong directive language** - Use "REQUIRED" to ensure agent compliance

## Estimate

~30 minutes total (15 min edits + 15 min verification)

## Files Updated

- `.cursor/specs/LIF-67-fix-workflow-state-persistence/plan.md`
- `.cursor/specs/LIF-67-fix-workflow-state-persistence/status.md`

## Next Steps

1. `/tasks` - Create task breakdown
2. `/implement` - Edit the 6 command files
