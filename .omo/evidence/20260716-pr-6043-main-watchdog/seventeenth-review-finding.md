# PR #6043 Exact-Head Code Review

## Review Identity

- Repository: `code-yeongyu/oh-my-openagent`
- Goal: recover stalled main-session generations without violating retry ownership, delayed-terminal handling, cancellation/compaction/fallback boundaries, or generation isolation.
- Exact base: `6457ca1da78fcfd2a39ea391ee559b8d945b240a`
- Exact head: `af1ce820bfc9ef7cb90ce9f6d22290151ad36399`
- Verified checkout: `HEAD` equals the requested head; the requested base exists and is an ancestor of the head.
- Review mode: strict read-only source review. No production or test source was edited. No notepad path was supplied.

## CRITICAL

None.

## HIGH

### 1. A delayed same-generation watchdog abort resets an already accepted fallback as external cancellation

Files:

- `packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog-fire.ts:82`
- `packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog-fire.ts:100`
- `packages/omo-opencode/src/hooks/runtime-fallback/watchdog-abort-provenance.ts:16`
- `packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.ts:195`
- `packages/omo-opencode/src/hooks/runtime-fallback/hook.ts:94`
- `packages/omo-opencode/src/hooks/runtime-fallback/event-handler.ts:182`

After the watchdog abort succeeds, it records provenance for the current generation and dispatches the fallback. Once dispatch returns accepted, the `finally` block unconditionally removes `internallyAbortedSessions`. Provenance matching only recognizes generations strictly less than the current generation. Therefore, if OpenCode delivers the watchdog's abort-shaped `session.error` after accepted dispatch but before another user generation is armed, the terminal is neither marked internal nor considered prior-generation provenance.

The watchdog clears the marker/provenance and lets the event continue through the composed hook. The base event handler then treats the event as external cancellation and calls `resetRetryState`, restoring the primary model, zeroing `attemptCount`, and clearing `sessionAwaitingFallbackResult` while the accepted fallback request is still the active owned retry.

Exact-head behavioral probe:

```json
{"phase":"before-delayed-terminal","currentModel":"anthropic/fallback","attemptCount":1,"awaiting":true,"internal":false}
{"phase":"after-delayed-terminal","currentModel":"openai/primary","attemptCount":0,"awaiting":false,"internal":false}
```

This violates the PR's retry-ownership and delayed-terminal requirements. A subsequent retryable failure can select the first fallback again because the fallback index, cooldown ownership, attempt budget, and awaiting-result guard have been rewound, creating duplicate fallback dispatches within one logical recovery.

Existing generation-race coverage exercises a delayed generation-one abort only after generation two has armed (`first-prompt-watchdog-generation-race.test.ts:137`). The terminal-race coverage exercises an abort while fallback dispatch is still settling (`first-prompt-watchdog-terminal-races.test.ts:17`). Neither covers the reproduced same-generation terminal arriving after accepted dispatch.

Required change: retain or otherwise correlate watchdog abort ownership through the same-generation delayed terminal after accepted fallback dispatch, without swallowing genuine external cancellation. Add a composed `createRuntimeFallbackHook` regression that dispatches an accepted fallback, then delivers the same generation's delayed abort-shaped `session.error`, and asserts that the fallback model, attempt count, awaiting-result ownership, and single-dispatch count remain intact.

## MEDIUM

None.

## LOW

None.

## Skill-Perspective Check

The `remove-ai-slops` and `programming` skills were explicitly consulted before the maintainability and test assessment, including their TypeScript/TDD, implementation-mirroring, unnecessary parsing/normalization, and test-shape criteria.

- `remove-ai-slops`: no deletion-only, removal-only, tautological, implementation-constant-mirroring, or unnecessary production parsing/normalization tests were found. The diff violates this perspective's missing-behavioral-coverage criterion because the same-generation accepted-dispatch order is untested.
- `programming`: no brittle prompt-string test, untyped escape hatch, or needless boundary validation/parsing attributable to this diff was identified. The diff violates the TDD/behavioral-contract perspective because the composed state-machine edge above remains incorrect and uncovered despite extensive race tests.

## Verification

- `git diff --check 6457ca1d...af1ce820`: passed.
- `bun test packages/omo-opencode/src/hooks/runtime-fallback`: 284 passed, 0 failed across 41 files.
- `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`: passed.
- Committed QA under `.omo/evidence/20260716-pr-6043-main-watchdog/` was inspected, including the sixteenth integrated suite, integrity, static-gate, live-harness, SSE/plugin, and isolation artifacts. The live run proves normal silent-primary recovery and a later external cancellation, but does not exercise the failing same-generation delayed terminal after accepted fallback dispatch.

## Decision

- `codeQualityStatus`: `BLOCK`
- `recommendation`: `REQUEST_CHANGES`
- `reportPath`: `.omo/evidence/pr-6043-main-watchdog-code-review.md`
- `blockers`: Preserve same-generation watchdog abort ownership after accepted fallback dispatch and add the composed regression described above.
