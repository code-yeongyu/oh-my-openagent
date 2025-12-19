# Fix Workflow State Persistence Gap

**Linear Issue**: [LIF-67](https://linear.app/lifelogger/issue/LIF-67)
**Created**: 2025-12-19
**Status**: Draft
**Type**: Bug Fix

## Overview

The workflow state persistence system has a critical gap: the `update_workflow_state` tool exists and is registered, but workflow commands don't instruct agents to call it. As a result, `workflow-state.json` files are never created, breaking session continuity and resume functionality.

## Problem Statement

### Current State (Broken)
1. `update_workflow_state` tool is implemented in `src/tools/spec/tools.ts`
2. Tool is registered in `src/index.ts`
3. `commandPreflight()` is called and validates prerequisites ✓
4. Workflow commands have proper frontmatter (step, requires, produces) ✓
5. **BUT**: Commands don't tell agents to call `update_workflow_state`
6. **RESULT**: `workflow-state.json` is never created

### Evidence
- Searched entire repo: **zero** `workflow-state.json` files exist
- Searched workflow commands: **no calls** to `update_workflow_state`
- Documentation claims functionality that doesn't work

### Impact
- Session continuity doesn't work
- Resume messages won't appear after session restart
- Workflow progress isn't tracked
- Linear status not synced with workflow state

## User Stories

- As a developer, I want workflow state persisted after each command so that I can resume work after session restart
- As a developer, I want to see a resume message when continuing work so that I know where I left off
- As a developer, I want artifact drift detection so that I'm warned when files change unexpectedly

## Requirements

### Functional Requirements

1. Each workflow command MUST instruct agents to call `update_workflow_state` after successful completion
2. The tool call MUST include:
   - `specPath`: Path to the spec folder
   - `step`: Current workflow step (specify|plan|tasks|implement|review|test)
   - `linearStatus`: Status from command's `linear_status` frontmatter
3. Instructions MUST be clear and actionable (not optional)
4. Instructions MUST appear after the main command steps complete

### Non-Functional Requirements

1. Changes should be minimal and surgical (just add instructions, don't refactor commands)
2. Instructions should follow existing command formatting style
3. Should work with the existing `update_workflow_state` tool signature

## Scope

### In Scope
- Add state update instructions to 6 workflow commands:
  - `/specify` (step: "specify", linearStatus: "todo")
  - `/plan` (step: "plan", linearStatus: "in_progress")
  - `/tasks` (step: "tasks", linearStatus: "in_progress")
  - `/implement` (step: "implement", linearStatus: "in_progress")
  - `/review` (step: "review", linearStatus: "in_review")
  - `/test` (step: "test", linearStatus: "in_review")

### Out of Scope
- Modifying the `update_workflow_state` tool itself
- Changing `commandPreflight` behavior
- Adding new workflow commands
- Refactoring existing command structure

## Files to Modify

| File | Change |
|------|--------|
| `.opencode/command/specify.md` | Add state update instructions |
| `.opencode/command/plan.md` | Add state update instructions |
| `.opencode/command/tasks.md` | Add state update instructions |
| `.opencode/command/implement.md` | Add state update instructions |
| `.opencode/command/review.md` | Add state update instructions |
| `.opencode/command/test.md` | Add state update instructions |

## Acceptance Criteria

- [ ] All 6 workflow commands have `update_workflow_state` call instructions
- [ ] Instructions are placed after main command steps complete
- [ ] Instructions specify correct step and linearStatus values
- [ ] Build passes after changes
- [ ] Running `/plan` on a spec folder creates `workflow-state.json`
- [ ] `workflow-state.json` contains correct currentStep, linearStatus, artifactHashes
- [ ] Documentation accurately reflects actual behavior

## Assumptions

1. The existing `update_workflow_state` tool implementation is correct
2. Agents will follow explicit instructions in command prompts
3. Tool signature: `update_workflow_state({ specPath, step, linearStatus })`

## References

- **Tool implementation**: `src/tools/spec/tools.ts`
- **Tool registration**: `src/index.ts`
- **Preflight implementation**: `src/shared/command-preflight.ts`
- **LIF-65 spec**: `.cursor/specs/LIF-65-feat-command-workflow-harmonization/`
- **Architecture docs**: `docs/architecture/12-workflow-system.md`
