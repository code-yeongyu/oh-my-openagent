# Start-Work Hardening Design

## Problem Statement
/start-work currently suggests an execution mode but does not enforce a choice, and it does not create a git worktree. This leaves agents free to start work without a clear execution strategy and without isolated workspace hygiene. We need to force mode selection, then automatically provision a worktree, and finally guide execution via the correct skill.

## Solution Design
Introduce a mandatory execution mode selection step and wire start-work to create a single plan-level git worktree. The hook will:
1. Determine the active plan and task count (existing behavior).
2. Inject a forced selection prompt that requires an explicit mode choice (no auto-run).
3. After a mode is selected, create or reuse a plan-level worktree named `worktree-{plan-name}` in `.worktrees/`.
4. Persist worktree metadata in boulder state and instruct the agent to load the mode-specific skill.

Key policy decisions:
- One worktree per plan, not per wave.
- Mode selection is mandatory (agent must not proceed until set).
- Worktree directory name is `worktree-{plan-name}` (sanitized, lowercased, spaces to `-`).

## Key Changes to `src/hooks/start-work/index.ts`
1. Replace the current auto-activation branch in `generateExecutionModePrompt` with a mandatory `question` tool prompt that only offers Sequential or Wave (no auto-select). Ensure the prompt explicitly blocks further execution until a selection is recorded.
2. Persist the selected mode to boulder state (new field on boulder state or dedicated execution config block) so resume flows do not re-prompt.
3. After plan selection (auto-selected, explicit, or resumed), call a new helper in `boulder-state/worktree-manager.ts` to provision the plan worktree before injecting the prompt guidance.
4. Update injected context to include:
   - Mode selected (or required prompt if missing)
   - Worktree path and branch
   - Required skill to load (`executing-plans` for Sequential, `wave-parallel-execution` for Wave)

## Integration with `worktree-manager`
Extend `src/features/boulder-state/worktree-manager.ts` with plan-level helpers that mirror the wave worktree patterns:
- `initializePlanWorktree(directory, planName)`: compute `worktree-{plan-name}` path under `.worktrees/`, create branch `worktree-{plan-name}` if missing, and update boulder state with `plan_worktree` metadata (path, branch, createdAt, status).
- `getPlanWorktree(directory)`: returns existing plan worktree metadata from state.
- `ensurePlanWorktree(directory, planName)`: idempotent wrapper that checks state, validates path existence, and creates the worktree if missing.
- Reuse `findOrCreateWorktreeDir`, `ensureGitignored`, and `listGitWorktrees` to avoid duplicate worktrees.

## Data Model Notes
Add a `plan_worktree` block in boulder state:
- `plan_worktree.path`
- `plan_worktree.branch`
- `plan_worktree.status` (pending|ready|failed)
- `plan_worktree.created_at`
- `plan_worktree.updated_at`

This allows resume flows to skip re-creation and offers visibility for cleanup utilities later.

## Error Handling
- If worktree creation fails, inject a blocking warning and do not proceed to execution instructions.
- If the worktree exists but the path is missing, run `git worktree prune` and retry.
- If `plan_worktree` exists and matches a valid path, reuse it without additional git operations.

## Non-Goals
- No changes to wave worktree logic beyond shared helpers.
- No automatic cleanup of plan worktrees in this change.
