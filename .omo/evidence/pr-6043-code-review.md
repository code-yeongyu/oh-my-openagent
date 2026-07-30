# PR #6043 Exact-Head Code Review

Date: 2026-07-17

## Review Identity

- Requested HEAD: `72b6e1bf14e29a3300d8a4d64830083b45c59616`
- Observed HEAD: `72b6e1bf14e29a3300d8a4d64830083b45c59616`
- Requested base: `14083b89f1cbf4680be13493a6c4afd67c957e8a`
- Observed merge base: `14083b89f1cbf4680be13493a6c4afd67c957e8a`
- Runtime source is unchanged from `3bb8bb8067e8ff98043aadfadf63a4db62c7fa8b`; the 16 later files are committed evidence only.
- `omo ulw-loop status --json` returned `ULW_LOOP_PLAN_MISSING`, so the required fallback report path is used.

## Skill-Perspective Check

The `remove-ai-slops` and `programming` skills, including the TypeScript and code-smell criteria, were explicitly consulted before judging maintainability and tests.

- `remove-ai-slops`: **violated**. The PR adds 4,689 test lines and many repeated local harness helpers, but omits four observable interleavings that leave fallback state stuck or suppress recovery. This is false confidence rather than behavior-locking coverage.
- `programming`: **violated**. Async lifecycle ownership is only partly generation-bound; `session.error`, timeout, and message continuations still carry a raw session ID across awaits. Tests mostly select individual implementation windows instead of proving the full observable retry transaction. No production file exceeds the 250 pure-LOC ceiling, although `first-prompt-watchdog.ts` is exactly 250.

## CRITICAL

None.

## HIGH

### 1. A fallback prompt's own user event invalidates the dispatcher, and `finally` strands retry ownership

`createAutoRetryDispatcher()` captures a generation at `packages/omo-opencode/src/hooks/runtime-fallback/auto-retry-dispatch.ts:38-40`. Every user `message.updated` bumps that generation at `packages/omo-opencode/src/hooks/runtime-fallback/event-handler.ts:97-104`, including the user event emitted for the fallback prompt itself.

If that event arrives before `promptAsync` returns, the accepted prompt is reclassified as blocked at `auto-retry-dispatch.ts:139-146`. The `return` inside `finally` at `auto-retry-dispatch.ts:225-227` overrides any prior outcome and exits before deleting `sessionRetryInFlight`. `dispatchFallbackRetry()` then restores the pre-fallback model because it sees an unaccepted result (`fallback-retry-dispatcher.ts:37-61`).

Exact-head probe observation:

```json
{
  "promptModels": ["openai/fallback"],
  "retryInFlight": true,
  "awaiting": true,
  "state": {
    "originalModel": "openai/primary",
    "currentModel": "openai/primary",
    "fallbackIndex": -1,
    "attemptCount": 0
  }
}
```

The fallback request was accepted on the wire, but bookkeeping says the primary model still owns the turn and retry remains permanently in flight. Later errors are skipped and the timeout path can clobber the accepted request again.

### 2. A stale status retry key survives generation rollover and suppresses the next turn

`session-status-handler.ts:65-73` stores a dedupe key and only releases it while the captured generation is current. A newer user turn bumps generation at `event-handler.ts:97-104` but does not clear `sessionStatusRetryKeys`. Therefore a stale status continuation correctly stops after an await, yet leaves its key behind. A normal next turn commonly emits the same normalized `attempt:1` key and is dropped at `session-status-handler.ts:65-67` before abort or fallback dispatch.

Exact-head probe observation:

```json
{
  "keyAfterOld": "1:provider unavailable, retrying",
  "keyAfterNew": "1:provider unavailable, retrying",
  "abortCalls": 0,
  "promptModels": []
}
```

The existing lifecycle test at `hook-abort-lifecycle-races.test.ts:169-214` proves only that the old continuation stops. It never sends the same retry signal in the new generation, so it misses the poisoned dedupe state.

### 3. An old `session.error` continuation can dispatch into and overwrite a newer user turn

`handleSessionError()` resolves agent context asynchronously at `event-handler.ts:139-150`, then continues using only `sessionID`. It captures no generation before the await and performs no generation check afterward. If a newer user message arrives while resolution is pending, the old error resumes against the newer turn's maps, clears awaiting/timeout state, advances the fallback state, and dispatches a prompt at `event-handler.ts:187-244`.

Exact-head probe observation after pausing old-error agent resolution, sending a newer user message, and then resuming:

```json
{
  "promptModels": ["openai/fallback"],
  "retryInFlight": false,
  "awaiting": true,
  "state": {
    "currentModel": "openai/fallback",
    "attemptCount": 1,
    "pendingFallbackModel": "openai/fallback"
  }
}
```

The old error has become a continuation in the new transaction. This is direct cross-generation state clobbering, not merely redundant work.

### 4. `session.deleted` retains a pending abort request, blocking same-ID reuse

Stale TTL cleanup deletes `internalAbortRequests` at `auto-retry-cleanup.ts:27-39`, but explicit deletion at `event-handler.ts:64-79` does not. `createAbortSessionRequest()` coalesces solely by session ID (`auto-retry-abort.ts:87-103`) and carries no generation/token identity.

When an ID is deleted and reused before its old abort settles, the replacement abort waits on the deleted generation's request and returns `false` without issuing a new wire abort. The old request remains recognized as current because the map entry was never invalidated.

Exact-head probe observation:

```json
{
  "mapRetainedAfterDelete": true,
  "beforeResolve": {"abortCalls": 1, "replacementSettled": false},
  "results": [true, false],
  "ownership": false
}
```

The new session cannot cancel its own request or enter fallback. `stale-cleanup-session-reuse.test.ts:91-183` covers TTL eviction, where the map is explicitly deleted, and therefore does not exercise the explicit-deletion lifecycle.

## MEDIUM

### 1. Large, duplicated test growth provides false confidence while missing transaction-level races

The PR changes 43 TypeScript test files with `+4,689/-370` lines. At least 26 runtime-fallback test files independently reimplement helpers such as deferred promises, prompt-model parsing, or hook contexts. The tests are green, but no test covers:

- the fallback prompt's own user event arriving before `promptAsync` settles;
- the identical status retry key after generation rollover;
- stale `session.error` agent resolution crossing a user turn;
- explicit `session.deleted` with a pending abort followed by same-ID reuse.

This violates both loaded skill perspectives: duplicated implementation-shaped fixtures make interleavings expensive to add, and the volume obscures the absence of end-to-end state invariants. Consolidate only where it enables observable transaction tests; test count alone is not the goal.

### 2. Generation protection is applied inconsistently across adjacent async lifecycle paths

The new token is used in the status handler and dispatcher, but neighboring paths still continue after awaits with raw session identity:

- `message-update-handler.ts:104-170` awaits abort and agent resolution without a generation check;
- `auto-retry-timeout.ts:48-101` awaits abort and dispatch against a captured mutable state object without generation identity;
- `hook.ts:125-138` resolves a deferred terminal after an async status probe using only session ID.

The four reproduced blockers already demonstrate that this inconsistency is operationally unsafe. These adjacent paths need adversarial transaction tests before the generation design can be considered complete.

## LOW

### 1. The review surface is disproportionately inflated by committed evidence

The full PR is 668 files and `+40,229/-704` lines. TypeScript production is `+1,766/-331`; tests are `+4,689/-370`; the remaining 590 files contribute `+33,774/-3`, primarily QA evidence. Repository policy requires evidence, but this volume materially raises review and repository-maintenance cost. The final 16 post-source files are evidence-only, so they do not mitigate the code defects above.

## Independent Verification

- Exact HEAD and merge base: verified.
- `bun test packages/omo-opencode/src/hooks/runtime-fallback`: **350 pass, 0 fail, 702 expectations across 54 files**.
- `bun run --cwd packages/omo-opencode typecheck`: pass.
- `bun run --cwd packages/utils typecheck`: pass.
- `git diff --check base..head`: pass.
- Pure LOC: `first-prompt-watchdog.ts` 250; `auto-retry-dispatch.ts` 241; `event-handler.ts` 222; `message-update-handler.ts` 202.
- The documented no-excuse helper could not be independently rerun: it failed before analysis with `TypeError: undefined is not an object (evaluating 'ts.ScriptTarget.Latest')`. This is a tool failure, but it means the committed claim that this exact gate passed remains unverified.
- No usable Biome executable was found in the checked dependency paths during this review; committed Biome output was treated as untrusted rather than promoted as independent evidence.
- Worktree was clean before the required report write; no source or GitHub state was mutated.

## Decision

- `codeQualityStatus`: **BLOCK**
- `recommendation`: **REQUEST_CHANGES**
- `reportPath`: `.omo/evidence/pr-6043-code-review.md`
- `blockers`:
  1. Make accepted fallback dispatch cleanup transaction-safe when its own user event advances lifecycle state; a `finally` return must not override accepted dispatch or retain `sessionRetryInFlight`.
  2. Scope or clear status dedupe keys on user-generation rollover.
  3. Bind `session.error` continuations to the generation that emitted the error.
  4. Invalidate pending abort requests on explicit deletion and prove same-ID reuse issues a fresh abort.
  5. Add deterministic tests for all four exact interleavings above.

<verdict>FAIL</verdict>

## Repair Verification

The blocking exact-head verdict above applies to contributor head
`72b6e1bf14e29a3300d8a4d64830083b45c59616`. The repair built on that head now
closes all reproduced ownership gaps plus four additional adversarial races found
while widening the transaction review:

1. retry dispatch uses an opaque owner token, releases only matching ownership,
   and preserves a prompt that was accepted before its own user event advanced
   lifecycle state;
2. status retry keys are cleared on a genuinely new user-message generation;
3. `session.error` and assistant-message continuations recheck generation after
   asynchronous abort or agent/message resolution;
4. explicit deletion invalidates a pending abort request before same-ID reuse;
5. model-fallback continuation ownership is tokenized across deletion and reuse;
6. session deletion detaches synchronous state and serializes same-ID recreation
   before awaited resource cleanup;
7. delayed cleanup, timeout, idle, disposal, and abort paths share retry-owner
   cleanup rather than deleting another transaction's marker; and
8. repeated `message.updated` events for the same user message no longer advance
   generation while a visible fallback-completion probe is in flight.

The eighth repair was discovered by the production-duration OpenCode run. The
first round-eight run emitted the complete fallback assistant response on SSE but
never logged completion bookkeeping. Its event stream showed a trailing update
for the same user message racing the asynchronous visibility lookup. A new
failing interleaving test and user-message-ID generation dedupe repaired that
path; the repeated real run then logged `Assistant response observed; cleared
fallback timeout` before a later genuine abort was classified as external.

Fresh candidate verification is preserved under
`.omo/evidence/20260717-pr-6043-final-round8/`:

- focused ownership matrix: 12 pass, 0 fail;
- full runtime-fallback suite: 358 pass, 0 fail, 717 expectations;
- lifecycle/model matrix: 25 pass, 0 fail;
- complete plugin event matrix: 60 pass, 0 fail;
- OpenCode adapter typecheck, pinned Biome 2.4.16 lint, no-excuse rules, and
  `git diff --check`: pass;
- isolated production-duration OpenCode QA: real 90-second watchdog fallback,
  primary transport abort, fallback completion, two-root deletion/restoration,
  and later external cancellation all observed; real DB count unchanged.

The repaired candidate requires fresh exact-head CI and independent review after
commit/push; those downstream gates do not retroactively change this original
head's `<verdict>FAIL</verdict>`.

The exact repaired source is split into three atomic commits:

- `fffed869ef00426a3b8df905324d5edcbbf217a9` binds runtime retry and
  continuation work to generation-aware ownership;
- `473d6a9c2a1ab4dae356013c09776571eeadf77e` tokenizes model-fallback
  continuation ownership; and
- `ec4beb1a5368a638167568759c5adb5a84ff1eb3` serializes deletion and
  recreation for a reused session ID.
