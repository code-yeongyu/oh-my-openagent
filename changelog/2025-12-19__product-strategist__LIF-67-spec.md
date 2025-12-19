# LIF-67 Specification: Fix Workflow State Persistence

**Date**: 2025-12-19
**Agent**: Product Strategist
**Linear Issue**: LIF-67

## Summary

Created specification for fixing the workflow state persistence gap in LIF-67.

## Problem Identified

The `update_workflow_state` tool exists and is registered, but workflow commands don't instruct agents to call it. Result: `workflow-state.json` is never created, breaking session continuity.

## Scope Defined

- Add state update instructions to 6 workflow commands
- Minimal, surgical changes - just add instructions
- Each command specifies correct step and linearStatus values

## Files Created

- `.cursor/specs/LIF-67-fix-workflow-state-persistence/spec.md`
- `.cursor/specs/LIF-67-fix-workflow-state-persistence/status.md`

## Next Steps

1. `/plan` - Create implementation plan
2. `/tasks` - Break down tasks
3. `/implement` - Add instructions to commands
