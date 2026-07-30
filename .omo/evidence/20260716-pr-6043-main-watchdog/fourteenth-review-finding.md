# PR #6043 Code Quality Review

## Pinned State

- PR: `#6043`
- Reviewed HEAD: `6a98b166045b8839985ebeaf4babe93301303da3`
- Pinned base and verified merge base: `16658f79c1155cb6f1b3bfaffa1f54ebd1469615`
- Runtime source commit: `0e7223d60b6cbbb04ddc92801f62fd6c09749e92`
- `git diff 0e7223d60..6a98b166 -- packages/omo-opencode/src/hooks/runtime-fallback AGENTS.md docs/reference/configuration.md docs/reference/features.md` is empty; the later commit is evidence-only.
- No ulw-loop plan exists, so this report uses the required fallback path. No notepad path was supplied.

## Verdict

- `codeQualityStatus`: `BLOCK`
- `recommendation`: `REQUEST_CHANGES`

## CRITICAL

None.

## HIGH

### A current provider error is misclassified as abort correlation and rewinds the fallback chain

`observeEventForWatchdog` passes `true` as the abort flag for every assistant `info.error`, including ordinary retryable provider errors (`packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog-events.ts:76-82`). While a prior-generation abort is suspended, `onAssistantProgress` interprets that flag as an abort-shaped correlation candidate. If the error belongs to the current user message, the parent ID is not prior, so the code resolves the deferred event as external cancellation (`packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.ts:141-155`). The composed hook then replays the old deferred `session.error` before processing the current provider error (`packages/omo-opencode/src/hooks/runtime-fallback/hook.ts:113-125`). Because the internal marker was removed, the base event handler resets the fallback state to the primary model and clears attempt/cooldown ownership (`packages/omo-opencode/src/hooks/runtime-fallback/event-handler.ts:182-193`).

Executable exact-head reproduction:

1. Generation 1 watchdog dispatches `anthropic/fallback-1`, leaving delayed abort provenance.
2. Generation 2 starts on `fallback-1`.
3. Generation 1's delayed abort-shaped `session.error` suspends generation 2.
4. Before the old assistant abort correlation arrives, generation 2 emits a retryable `ProviderRateLimitError` with `parentID: user-2`.

Observed output from the composed `createRuntimeFallbackHook`:

```text
{"dispatched":["anthropic/fallback-1","anthropic/fallback-1"],"currentModel":"anthropic/fallback-1","attemptCount":1,"fallbackIndex":0}
```

The second dispatch should advance to `google/fallback-2` with `attemptCount: 2`. Instead, the old abort replay resets the state and retries the already-failed first fallback. This defeats cooldown and max-attempt accounting and can create repeated retries of the same failing model.

The current adapter test masks the distinction: its recording watchdog discards `parentMessageID` and `isAbortEvent` (`packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog-event-observation.test.ts:10-20`), and the non-abort `RateLimitError` case asserts only that generic progress occurred (`first-prompt-watchdog-event-observation.test.ts:148-157`). Existing composed deferred-terminal tests use `MessageAbortedError`, so this ordering remains uncovered.

## MEDIUM

None.

## LOW

None.

## Verification

- Verified checked-out `HEAD` exactly equals `6a98b166045b8839985ebeaf4babe93301303da3`.
- Verified `git merge-base 16658f79c... 6a98b166...` exactly equals `16658f79c1155cb6f1b3bfaffa1f54ebd1469615`.
- Inspected the complete pinned diff, surrounding runtime-fallback state machine, changed tests, and `.omo/evidence/20260716-pr-6043-main-watchdog`.
- Independently ran `bun test packages/omo-opencode/src/hooks/runtime-fallback`: `281 pass`, `0 fail` across 39 files. The executable reproduction above still fails the intended fallback-chain behavior, proving a missing regression case.
- `git diff --check` passed.
- Latest evidence artifacts report passing typecheck, Biome, no-excuse audit, OpenCode harness self-check, production-duration live fallback, later external cancellation, and unchanged real OpenCode DB. The live scenario is valid for its exercised ordering but does not cover a current non-abort provider error while prior-abort correlation is suspended.

## Skill Perspective Check

The `remove-ai-slops` and `programming` skills were explicitly loaded, along with the TypeScript and code-smell references, before judging test relevance and maintainability.

- `remove-ai-slops`: the diff has no deletion-only tests, removal-only assertions, tautological constant mirrors, or unnecessary production parsing/normalization. It does violate the behavior-coverage perspective because the event-observation fake erases the classification data that drives the state machine, creating false confidence around `info.error`.
- `programming`: no new prompt-string brittleness, `any`, non-null assertion, or needless abstraction was found. The diff violates the perspective by collapsing two semantic variants, abort errors and retryable provider errors, into one boolean branch and by lacking a composed observable regression for that distinction.

## Blockers

1. Classify assistant `info.error` with `isAbortError(info.error)` instead of treating every error as abort correlation. A non-abort provider error must not resolve a deferred prior abort as current cancellation; it should preserve prior internal ownership while the normal message error handler advances the fallback chain.
2. Add a composed regression for the exact sequence above and assert dispatch order `[fallback-1, fallback-2]`, `attemptCount === 2`, and preservation after the delayed old abort correlation completes.
3. Re-run the runtime-fallback suite, static gates, and scoped real OpenCode QA, recording repaired-head evidence as required by the repository.
