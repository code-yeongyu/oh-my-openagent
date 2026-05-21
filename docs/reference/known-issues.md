# Known Issues

Tracks bugs that are present in the current release but have been intentionally deferred. Each entry should explain the symptom, the history, any workaround, and the planned resolution.

## v4.2.1 - Delegate-task early-failure-fallback (BLOCKER-4, resolved)

BLOCKER-4 is resolved in v4.2.1. Delegated child sessions now retain the first prompt payload before dispatch and consume that bootstrap payload exactly once when runtime fallback must retry an empty-history child session.

## v4.2.0 - Delegate-task early-failure-fallback (BLOCKER-4, deferred from PR #3825)

### Symptom

A delegated child session that fails on its very first `promptAsync` call (for example, the provider rejects the request before any session history is persisted) may not advance to the configured fallback models. The session ends in early failure instead of retrying with the next fallback in the chain.

This affects subagents launched via the delegate-task tool (background or sync) where the first provider call fails immediately and `session.messages` is still empty.

### History

PR #3825 (`tw-yshuang/fix/delegated-child-session-early-failure-fallback`, merged as `cd33f3a39` and then `fac90d69f` on 2026-05-07) introduced a shared bootstrap context (`src/shared/delegated-child-session-bootstrap.ts`) to capture the retry payload before the first prompt dispatch, so empty-history failures could still retry with the fallback chain.

After the merge landed on `dev`, the PR's own regression test (`delegated child-session empty-history fallback retries with captured bootstrap prompt` in `src/hooks/runtime-fallback/index.test.ts`) failed on a clean root `bun test --timeout 30000` run (6828 pass / 1 fail). PR #4044 (`code-yeongyu/revert/3825-delegated-bootstrap`, revert commit `3c7d1299a`, merge-revert commit `e2b8e49e2`, merged on 2026-05-15) reverted the merge to keep `dev` green (6823 pass / 0 fail / 6 skip across 709 files).

The original failure-mode the PR targets remains in v4.2.0.

### Workaround

- For delegated subagents, prefer providers that succeed reliably on the first call (rarely fail with auth/quota errors at request time).
- Configure fallback models conservatively in `categories[].fallback_models` and accept that the very first failure may not auto-retry.
- The existing runtime-fallback persisted-history retry path still works after the subagent produces any history.

### Tracking

Issue #4059 tracks the reland with stabilized regression coverage. The reland is deferred to a follow-up release and should account for current schema-shape changes plus prompt-async-gate semantics.

## #4225 — Custom LSP config in `.opencode/oh-my-openagent.jsonc` is silently ignored

- **Affects**: v4.2.3+ after the LSP to MCP migration.
- **Symptom**: Custom LSP server configuration in your project's `oh-my-openagent.jsonc` is not applied at runtime.
- **Workaround**: Configure your LSP server through OpenCode's native `lsp` config instead.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/4225.
