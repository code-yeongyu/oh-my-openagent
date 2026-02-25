# GitLab Issue Update and MR Template

## Issue Update (Paste-ready)

### Status

- `In Progress -> Ready for Review`
- Type: regression fix only (scope locked)

### Completed

- Stabilized first-hop provider handling in model fallback path.
- Removed cross-test leakage in session-notification command lookup helper.
- Restored mock cleanup in session-notification related plugin test.

### Root Cause

- Fallback provider selection behavior varied under retry chains.
- Notification tests were affected by shared runtime/mock state across files.

### Validation Evidence

```bash
bun test src/shared/model-error-classifier.test.ts \
  src/hooks/model-fallback/hook.test.ts \
  src/plugin/event.model-fallback.test.ts \
  src/cli/model-fallback.test.ts \
  src/hooks/session-notification.test.ts \
  src/hooks/session-notification-input-needed.test.ts \
  src/plugin/tool-execute-before-session-notification.test.ts \
  src/cli/mcp-oauth/login.test.ts

bun run typecheck
bun run build
```

### Risk and Rollback

- Risk: low-to-medium, localized behavior changes
- Rollback: revert issue-scoped files only and rerun the same verification chain

---

## MR Description (Paste-ready)

### What

- Fix fallback and notification regression behavior.
- Improve test isolation for session-notification path.
- Add issue-aligned delivery docs for consistent workflow.

### Why

- Batch-run instability made regression verification unreliable.
- Issue delivery needed explicit acceptance criteria and review artifacts.

### Files

- `src/hooks/model-fallback/hook.ts`
- `src/hooks/session-notification-utils.ts`
- `src/plugin/tool-execute-before-session-notification.test.ts`
- `docs/guide/gitlab-issue-regression-delivery-plan.md`
- `docs/guide/gitlab-issue-regression-delivery-template.md`

### Validation

- Regression tests: pass
- Typecheck: pass
- Build: pass

### Risk

- No API shape changes
- Behavior changes are localized to fallback/notification flows

### Rollback

- Revert touched files and rerun validation commands
