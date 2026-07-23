# PR #6043 Independent Exact-Head Code Review, Lane 2 of 5

Date: 2026-07-17

## Review Identity

- Base: `6457ca1da78fcfd2a39ea391ee559b8d945b240a`
- Head: `c0f209443e3dc06446f14af02c68afe5a2c63ba1`
- Merge base: `6457ca1da78fcfd2a39ea391ee559b8d945b240a` (exact)
- Range: `6457ca1da78fcfd2a39ea391ee559b8d945b240a..c0f209443e3dc06446f14af02c68afe5a2c63ba1`
- Worktree was clean before this report was written.

## Skill-Perspective Check

The `programming` TypeScript perspective and `remove-ai-slops` overfit/slop perspective were explicitly loaded and applied before judging maintainability and tests.

- `programming`: violated by missing caller-level regression coverage for the newly typed abort-failure outcome. The handler tests mirror only the successful helper outcome instead of binding observable dispatch ownership on rejection.
- `remove-ai-slops`: violated for the same reason. The new tests give false confidence by hard-coding successful aborts in the affected handler seams while the production failure branch remains untested.
- No needless production parsing/normalization, deletion-only test, or oversized changed production module was found. `first-prompt-watchdog.ts` is exactly 250 pure LOC.

## CRITICAL

None.

## HIGH

### 1. Provider retry-signal handlers dispatch a replacement after abort rejection

`createAbortSessionRequest()` now returns `false` when the host abort rejects and removes its internal-abort marker (`packages/omo-opencode/src/hooks/runtime-fallback/auto-retry-abort.ts:30-45`). The watchdog and timeout callers honor that ownership result, but both provider-signal handlers ignore it:

- `message-update-handler.ts:103-110` deletes `sessionRetryInFlight` after an unconditionally awaited abort.
- `message-update-handler.ts:198-203` dispatches the quota fallback even when that abort returned `false`.
- `session-status-handler.ts:63-75` likewise releases in-flight ownership after an unacknowledged abort.
- `session-status-handler.ts:137-145` always advances and dispatches the fallback after the second abort call.

When the abort fails because the original provider request is still active, these paths advance fallback state and submit or queue another prompt without owning cancellation of the original request. That permits a delayed original completion followed by a duplicate fallback turn, and it breaks the PR's abort/fallback ownership contract.

An independent exact-head handler probe returned:

```text
{"messageAbortRejected":{"aborts":1,"dispatches":1},"statusAbortRejected":{"aborts":1,"dispatches":1}}
```

The affected tests force abort success (`message-update-handler.test.ts:138-151`, `session-status-handler.test.ts:53-67`) and contain no rejection case. This is why all current suites pass despite the defect.

Required fix: branch on the boolean abort outcome in every provider retry-signal/quota path. On `false`, preserve retry/pending ownership and do not call `dispatchFallbackRetry`. Add observable regressions for both `message.updated` and `session.status` proving abort rejection causes zero fallback prompt/dispatch and leaves existing ownership intact.

## MEDIUM

None beyond the test-coverage defect incorporated into the HIGH finding.

## LOW

None.

## Verified Coverage

- Full runtime-fallback suite: 291 pass, 0 fail.
- Main-session lifecycle/event/state suite: 53 pass, 0 fail.
- `packages/omo-opencode` typecheck: pass.
- `git diff --check` for the exact range: pass.
- Two active roots, latest-root deletion restoration, missing created-session ID, compaction markers, `timeout_seconds=0`, subagent eligibility removal, stale generations, delayed terminals, idle/error/progress orderings, fallback completion, cancellation during abort, and disposal were traced in production and covered by focused tests or the isolated live evidence.
- The committed live QA is pinned to source commit `243a25ca97c46cfbf5fdb472aeef3da37c301906`; final head changes after it are evidence-only. It proves the two-root watchdog scenario and database isolation but does not exercise abort rejection.

## Verdict

- codeQualityStatus: BLOCK
- recommendation: REQUEST_CHANGES
- reportPath: `.omo/evidence/pr-6043-lane-2-code-review.md`
- blockers:
  1. Honor `abortSessionRequest === false` before releasing retry ownership, advancing fallback state, or dispatching/queueing a replacement in `message-update-handler.ts` and `session-status-handler.ts`.
  2. Add caller-level abort-rejection regressions for both event paths.
