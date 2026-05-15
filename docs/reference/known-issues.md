# Known Issues

## v4.2.0 - Delegate-task early-failure-fallback (BLOCKER-4, deferred from PR #3825)

### Symptom

Delegated child sessions that fail on their first `promptAsync` call, for example when the provider rejects the request before any session history is persisted, may not advance to the configured fallback models. The session ends in early failure instead of retrying with the next fallback in the chain.

### History

PR #3825 (`fix/delegated-child-session-early-failure-fallback`, merged as `cd33f3a39` and later as `fac90d69f` on 2026-05-07) introduced a shared bootstrap context (`src/shared/delegated-child-session-bootstrap.ts`) to capture the retry payload before the first prompt dispatch so empty-history failures could still retry. After the merge landed on `dev`, the PR's own regression test (`delegated child-session empty-history fallback retries with captured bootstrap prompt` in `src/hooks/runtime-fallback/index.test.ts`) failed on a clean root `bun test --timeout 30000` run (`6828 pass / 1 fail`). PR #4044 reverted the merge on 2026-05-15 to keep `dev` green. The fix will be re-attempted in v4.2.1 after the regression test is stabilized against the post-#4032 schema and prompt-async-gate timing semantics.

### Workaround

For delegated subagents, configure fallback models conservatively, or avoid delegating to providers that frequently fail on the first prompt call. The existing runtime-fallback persisted-history retry path still works after the subagent has produced any history.

### Tracking

A follow-up issue will track the reland with stabilized regression coverage targeting v4.2.1.
