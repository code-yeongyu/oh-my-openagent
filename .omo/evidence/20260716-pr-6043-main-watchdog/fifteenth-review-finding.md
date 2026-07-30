# PR #6043 Code Quality Review

## Pinned State

- PR: `#6043`
- Pinned base: `fb7d4b66f541e22e9718a4f51314702c6ac68e53`
- Pinned head and checked-out `HEAD`: `74aba302d69a128b8b95f9550027180fd66b2ecf`
- Verified merge base: `fb7d4b66f541e22e9718a4f51314702c6ac68e53`
- Scope: exact range `fb7d4b66f541e22e9718a4f51314702c6ac68e53..74aba302d69a128b8b95f9550027180fd66b2ecf`
- No ulw-loop plan exists, so this report uses the required fallback path. No notepad path was supplied.

## Verdict

- `codeQualityStatus`: `BLOCK`
- `recommendation`: `REQUEST_CHANGES`
- `reportPath`: `.omo/evidence/pr-6043-code-review.md`

## CRITICAL

None.

## HIGH

### A provider `session.error` during suspended abort correlation rewinds fallback state and retries the failed model

When a delayed prior-generation abort has suspended the current watchdog, `onSessionTerminal` treats every later non-idle terminal event as correlation resolution. For a retryable, non-abort provider `session.error`, it deletes `internallyAbortedSessions`, cancels the suspended generation, and returns `resolve-terminal` (`packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.ts:173-179`).

The composed hook then replays the old deferred abort before processing the current provider error (`packages/omo-opencode/src/hooks/runtime-fallback/hook.ts:113-127`). Because the internal ownership marker was just deleted, the replayed abort is classified as genuine cancellation and resets retry state (`packages/omo-opencode/src/hooks/runtime-fallback/event-handler.ts:182-193`). The current retryable provider error then starts from the rewound state instead of advancing the fallback chain.

Reproduced sequence against the exact pinned head:

1. Generation 1 watchdog dispatches `anthropic/fallback-1`.
2. Generation 2 starts on `fallback-1`.
3. A delayed generation-1 abort-shaped `session.error` suspends generation 2.
4. Generation 2 emits a retryable provider `session.error` with status 429.

Observed composed-hook state:

```json
{"dispatched":["anthropic/fallback-1","anthropic/fallback-1"],"currentModel":"anthropic/fallback-1","attemptCount":1,"fallbackIndex":0}
```

Expected dispatches are `[fallback-1, fallback-2]` with `attemptCount === 2`. Repeating fallback one defeats max-attempt and cooldown accounting and can repeatedly retry the same failed provider/model.

The added regression is useful but does not cover this transport. `hook-provider-error-correlation.test.ts:92-117` proves advancement when the provider failure arrives as assistant `message.updated`; production also handles retryable provider failures delivered directly as `session.error`, and that sibling route remains uncovered.

## MEDIUM

None.

## LOW

None.

## Verification

- Inspected the complete pinned diff: 197 changed files, including all runtime-fallback production changes, tests, and committed evidence.
- Focused reviewer run: `43 pass`, `0 fail`.
- Full `packages/omo-opencode/src/hooks/runtime-fallback` reviewer run: `282 pass`, `0 fail`.
- `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`: pass.
- `git diff --check fb7d4b66f541e22e9718a4f51314702c6ac68e53..74aba302d69a128b8b95f9550027180fd66b2ecf`: pass.
- Existing exact-head suite evidence: `.omo/evidence/20260716-pr-6043-main-watchdog/fourteenth-exact-runtime-fallback-suite.txt`.
- Existing exact-head static evidence: `.omo/evidence/20260716-pr-6043-main-watchdog/fourteenth-exact-omo-opencode-typecheck.txt` and `.omo/evidence/20260716-pr-6043-main-watchdog/fourteenth-exact-integrity.txt`.
- Existing live evidence: `.omo/evidence/20260716-pr-6043-main-watchdog/fourteenth-exact-live-watchdog-run.txt`. It validly proves silent-primary fallback and a later external user abort, but it does not exercise a retryable provider `session.error` while prior-abort correlation is suspended.

Passing suites do not invalidate the finding because none drives the failing event transport and ordering above.

## Skill Perspective Check

The `remove-ai-slops` and `programming` skills were explicitly loaded before judging test relevance and maintainability, including their TypeScript and code-smell criteria.

- `remove-ai-slops`: no deletion-only tests, removal-only assertions, tautological constant mirrors, or unnecessary production parsing/normalization were found. The diff violates the test-quality perspective by covering only the assistant-message provider-error route and thereby creating false confidence for the supported `session.error` route.
- `programming`: no prompt-test brittleness, untyped escape hatch, or needless abstraction was found. The diff violates the behavioral-testing perspective because the lifecycle behavior is transport-dependent without a composed observable regression for the production `session.error` path.

## Blockers

1. Preserve suspended prior-abort ownership when the current terminal event is a non-abort provider `session.error`; processing that provider error must advance from fallback one to fallback two rather than replaying an unowned abort that resets state.
2. Add a composed regression for the exact sequence above, asserting dispatch order `[fallback-1, fallback-2]`, `attemptCount === 2`, and correct ownership cleanup after correlation completes.
3. Re-run the scoped runtime-fallback, static, and real OpenCode QA gates and record repaired-head evidence.
