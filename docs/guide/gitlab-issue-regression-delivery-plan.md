# GitLab Issue-Aligned Delivery Plan (Regression Fixes)

## Goal

Ship the current regression fixes with strict issue workflow discipline:

- Lock scope to regression stabilization.
- Verify with deterministic evidence.
- Prepare review-ready update/MR materials.

## Scope Lock

This issue only covers the following files:

- `src/hooks/model-fallback/hook.ts`
- `src/hooks/session-notification-utils.ts`
- `src/plugin/tool-execute-before-session-notification.test.ts`
- `docs/guide/gitlab-issue-regression-delivery-plan.md`
- `docs/guide/gitlab-issue-regression-delivery-template.md`

Out of scope:

- New features
- Cross-repo architecture changes
- Unrelated dirty worktree files

## Delivery Phases

### Phase A - Implement

1. Keep fallback provider deterministic for first-step fallback selection.
2. Remove session-notification command lookup state leakage.
3. Restore test isolation for session state mocking.

### Phase B - Verify

Run and record:

1. Targeted regression test batch
2. Extended related test batch
3. `bun run typecheck`
4. `bun run build`

### Phase C - Handoff

1. Post issue status update with root cause + fix summary.
2. Publish MR description with verification evidence and rollback notes.

## Acceptance Criteria

### AC-1 Model Fallback

- Given retryable model errors
- When fallback is applied
- Then first-hop provider selection remains stable and tests pass

### AC-2 Session Notification

- Given idle/question/permission notification paths
- When tests run as a batch
- Then notification assertions remain stable (no batch-only zero-notification regressions)

### AC-3 Quality Gates

- Regression test suite passes
- `bun run typecheck` passes
- `bun run build` passes

## Risk and Rollback

Risk level: low-to-medium.

Rollback strategy:

- Revert only the touched files in this issue scope.
- Re-run the same verification chain.

## Suggested Commit Slices

1. `fix(hooks): stabilize fallback and notification regression paths`
2. `docs(guide): add GitLab issue delivery plan and templates`
