# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [4.2.0] - 2026-05-16

### Added

- prompt-async-gate: new shared safety primitive (`src/shared/prompt-async-gate.ts`) with `promptAsyncAfterSessionIdle`, `promptAfterSessionIdle`, `releasePromptAsyncReservation`, `DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS` public exports. Routes 13+ internal hook callers through reservation-based duplicate-injection prevention. See `docs/reference/prompt-async-gate-rfc.md`.
- Background-agent: extracted `ParentWakeNotifier` module for parent-wake coalescing (preparatory refactor; manager.ts integration in same release).
- First-prompt watchdog for stuck subagents (closes #3952 by way of #4051).
- Subagent quota abort fast-path when no fallback is configured (closes #4006).

### Fixed

- prompt-async-gate: add dispatch timeout via `Promise.race`, fix post-dispatch reservation hold on throw, harden prefix release to require `:` suffix (BLOCKER-1, BLOCKER-2, HIGH-6, HIGH-7 partial).
- model-suggestion-retry: release reservation before suggested-model retry attempt (regression caused by post-dispatch hold landing).
- session-recovery: schema-compatible synthetic tool results (PR #4053 supersedes #3866).
- tool-pair-validator: schema-compatible synthetic results for background sessions (PR #4032).
- claude-code-hooks: accumulate modifiedInput on allow/deny/ask exit paths (PR #3299 area, multiple commits).
- runtime-fallback: dedupe overlapping continuations, preserve provider-specific retries, classify localized provider errors.
- team-mode: skip tmux layout when opencode server unreachable (closes #3894).
- delegate-task: honor user fallback_models when category primary is unreachable.
- background-agent: detect stalled active sessions, coalesce rapid idle parent notifications, retry transient missing output tasks.
- todo-continuation: remove activity-based stagnation bypass, clean up idle event diagnostics.
- AGENTS.md: strengthened prompt-injection danger warning with root-cause analysis, gate semantics, forbidden patterns, and required tests.

### Changed

- TypeScript audit: prompt-async-route-audit migrated from regex to TypeScript AST walker, catching destructuring, bracket call, optional chaining, and type-cast aliased bypass patterns (HIGH-5).
- Public surface: `createPluginModule` test seam moved from `src/index.ts` to `src/testing/create-plugin-module.ts` (HIGH-8). Plugin default export `pluginModule` is unchanged.
- CI: removed sharded test runner; now uses plain `bun test` in a single process (test-discipline.md added to enforce no-`setTimeout`-in-tests).
- Background-agent: manager.ts internal parent-wake state delegated to `ParentWakeNotifier` (HIGH-9).

### Known Issues

- Delegated child-session early-failure fallback (PR #3825 reverted). Delegated subagents that fail on the very first `promptAsync` may not advance to fallback models. See `docs/reference/known-issues.md`. Reland targets v4.2.1.

### Internal

- New `.sisyphus/rules/test-discipline.md` rule: forbids `setTimeout(resolve, N)` and `await sleep(N)` in test bodies unless time itself is the SUT.
- mock.module lifecycle audit test (`src/shared/mock-module-lifecycle-audit.test.ts`) added to catch unpaired mocks (H10).
- Public exports for prompt-async-gate primitives - MINOR semver bump justified.
