# PR #6043 Code Quality Review

## Pinned State

- Base: `6457ca1da78fcfd2a39ea391ee559b8d945b240a`
- Head and checked-out `HEAD`: `61f9736aa037ddf016f66452d92c8f082ad8c704`
- Tested runtime source: `7020af726e1f21cea5eb1a57febd8bfa38832c1c`
- The base is the exact merge-base, and `7020af726` is an ancestor of the evidence-only head.
- `omo ulw-loop status --json` returned `ULW_LOOP_PLAN_MISSING`; this fallback report path is therefore used.

## Verdict

- `codeQualityStatus`: `BLOCK`
- `recommendation`: `REQUEST_CHANGES`
- `reportPath`: `.omo/evidence/pr-6043-code-review.md`

## CRITICAL

None.

## HIGH

### 1. Out-of-order aborts from two completed watchdog generations rewind the newest successful fallback

Files:

- `packages/omo-opencode/src/hooks/runtime-fallback/watchdog-abort-provenance.ts:2-3`
- `packages/omo-opencode/src/hooks/runtime-fallback/watchdog-abort-provenance.ts:27-40`
- `packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.ts:195-213`
- `packages/omo-opencode/src/hooks/runtime-fallback/hook-current-generation-delayed-terminal.test.ts:132-185`
- `packages/omo-opencode/src/hooks/runtime-fallback/hook-multiple-delayed-terminals.test.ts:112-139`

Abort provenance is retained as a set of generations, but successful completion is retained as only one generation. After two silent turns both recover and complete, provenance can be `{generation1, generation2}` while the completion marker is only `generation2`. If generation 2's delayed abort arrives first, `consumeCurrent()` correctly consumes it and deletes the single completion marker. When generation 1's delayed abort arrives next, there is no armed watchdog to suspend and no completed marker authorizing consumption, so lines 211-212 clear provenance and the event reaches the base handler as external cancellation. That resets the session from the newest fallback to the failed primary model and zeroes the attempt count.

Independent composed-hook reproduction against exact `HEAD`:

```json
{
  "before": { "dispatched": ["anthropic/fallback-1", "google/fallback-2"], "model": "google/fallback-2", "attempts": 2 },
  "afterNewer": { "model": "google/fallback-2", "attempts": 2 },
  "afterOlder": { "model": "openai/primary", "attempts": 0 }
}
```

This directly violates the PR goal's multiple-generation, completed-fallback, delayed-abort, fallback-ownership, and retry-state requirements. The tests cover one completed generation and multiple pending/active generations separately, but never two completed generations with out-of-order terminals.

Required change: preserve independently consumable completed ownership for every retained watchdog generation, while still ensuring a genuine cancellation from a later active generation is not swallowed. Add a composed regression with two visible fallback completions followed by newest-then-oldest delayed abort terminals, plus the adjacent later-generation cancellation boundary.

## MEDIUM

### 1. `session.deleted` can leave watchdog generation entries behind while armed or suspended

File: `packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.ts:42-55,175-193,214-232`

`sessionGenerations.delete(sessionID)` runs only when no watchdog is armed. If deletion arrives while the watchdog is armed, `cancel()` increments and retains the map entry. The suspended branch also calls `cancel()` and returns before deleting it. Timers and provenance are cleared, so this is not the blocking state-rewind defect, but a long-lived plugin can retain one generation entry for every session deleted in either state. Existing deletion tests verify adapter routing/base state cleanup, not this private watchdog lifecycle.

## LOW

None.

## Skill-Perspective Check

The `remove-ai-slops`, `programming`, TypeScript, code-smell, and code-review skills were explicitly loaded and applied before judging maintainability and tests.

- `remove-ai-slops`: no deletion-only, removal-only, tautological, or constant-mirroring tests were found, and no unnecessary production parsing/normalization was added for this goal. The diff does violate the behavior-coverage perspective because the single-completion and multi-generation tests leave their combined observable race uncovered, creating false confidence.
- `programming`: no new `any`, `@ts-ignore`, prompt-string tests, or oversized changed module was found (`first-prompt-watchdog.ts` is exactly 250 pure lines). The diff violates the observable-behavior test perspective through the missing two-completed-generation regression and has the session-deletion cleanup gap above.

## Verification

- `git diff --check base...head`: pass.
- `bun test packages/omo-opencode/src/hooks/runtime-fallback`: 286 pass, 0 fail across 42 files.
- `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`: pass.
- Exact-source evidence is present: runtime `7020af726` is unchanged through head `61f9736aa`; the isolated live OpenCode run proves one production-duration silent-main recovery, visible fallback completion, later user cancellation, and unchanged real database.
- The live QA is credible for that single-generation path, but it does not exercise two completed watchdog generations or out-of-order delayed terminals and therefore does not cover the reproduced blocker.

## Blockers

1. Make completed abort ownership generation-complete rather than single-generation so all retained completed watchdog terminals can be consumed safely in any arrival order.
2. Add a composed two-completed-generation regression and retain explicit later-generation cancellation coverage.
