# PR #6043 Code Quality Review

## Pinned State

- Repository: `code-yeongyu/oh-my-openagent`
- PR: `#6043`
- Reviewed HEAD: `1b4b6428f117ff95bffd18f8a1b6846fb46376db`
- Pinned base / merge base: `16658f79c1155cb6f1b3bfaffa1f54ebd1469615`
- Runtime source commit: `03762c06deaee52f60b07d9c227c634a9e7e955e`
- `git diff 03762c06d..HEAD` over the runtime-fallback source and edited docs was empty; later commits are evidence-only.

## Verdict

- `codeQualityStatus`: `BLOCK`
- `recommendation`: `REQUEST_CHANGES`

## CRITICAL

None.

## HIGH

### A user turn arriving during deferred abort correlation inherits the prior generation's deadline and can be aborted almost immediately

The watchdog suspends generation N when a delayed prior-generation abort-shaped `session.error` arrives (`packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.ts:183`). While suspended, every later user message is discarded by the early return at `first-prompt-watchdog.ts:109`; the session generation, current user message ID, model, agent, and deadline are not updated. If the delayed assistant error then identifies the older parent, `onAssistantProgress` requests status inspection (`first-prompt-watchdog.ts:140`). A busy status causes `resolveDeferredTerminal` to re-arm the stored generation-N context (`first-prompt-watchdog.ts:215`), preserving its original deadline through `arm()` (`first-prompt-watchdog.ts:58`). The busy request may actually be generation N+1, so the old timer owns and aborts the new request.

Pinned-code reproduction using a 30 ms watchdog:

1. Generation 1 times out and records abort provenance.
2. Generation 2 arms; 22 ms later its state is suspended by the delayed generation-1 `session.error`.
3. Generation 3 calls `onUserMessage` while suspended and is ignored.
4. Generation-1 assistant correlation returns `inspect-terminal`; resolving status as busy re-arms generation 2 with only 8 ms remaining.
5. The second `first-prompt-watchdog` abort fires 8 ms after generation 3 arrived.

Observed output:

```text
deferred=defer-terminal
inspect=inspect-terminal
resolved=resolve-terminal
secondAbortAfterGeneration3Ms=8
```

This is a cancellation/generation ownership violation on the central behavior of the PR: a current explicit user request can be aborted by an older generation's watchdog deadline. Existing three-generation tests do not cover the window: they resolve generation 2 first and only then arm generation 3 (`packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog-three-generation.test.ts:66` and `:85`).

## MEDIUM

### Main-session scope is inferred from absence in `subagentSessions`, capturing parent-linked internal sessions

`onUserMessage` treats every session absent from `subagentSessions` as a main session (`packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.ts:112`). The repository already has authoritative lineage from `session.created.properties.info.parentID` (`packages/omo-opencode/src/plugin/event-session-lifecycle.ts:65`) and `getMainSessionID()`, but the watchdog uses neither.

At least two internal child paths are not registered in `subagentSessions`: `look_at` creates a parent-linked child and immediately sends a synchronous prompt (`packages/omo-opencode/src/tools/look-at/look-at-session-runner.ts:34`, `:65`), and Ralph reset iterations create a parent-linked child before dispatch (`packages/omo-opencode/src/hooks/ralph-loop/session-reset-strategy.ts:11`; `iteration-continuation.ts:34`). With runtime fallback enabled, `timeout_seconds > 0`, and a matching agent fallback chain, these child requests are eligible for the new main-session watchdog, allowing runtime-fallback to compete with the feature that owns the child request. No test covers parent-linked, unregistered sessions.

### Oversized changed test module violates both required skill perspectives

`packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.test.ts` is 286 pure LOC and has no `SIZE_OK` justification. The consulted `remove-ai-slops` and `programming` criteria set a 250-pure-LOC ceiling for production and test modules. This does not cause the runtime blocker, but it increases review cost in an already race-heavy state machine and should be split by behavior cluster.

## LOW

None.

## Verification

- Independently ran `bun test packages/omo-opencode/src/hooks/runtime-fallback`: 279 passed, 0 failed.
- Independently ran `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`: passed with no output.
- Independently ran 71 focused watchdog/deferred-terminal tests: 71 passed, 0 failed.
- Inspected the exact-head live evidence. It has artifact paths, demonstrates isolated OpenCode execution, fallback recovery, later external cancellation, and unchanged real DB state. It is valid for the exercised two-turn sequence, but it does not exercise a new user turn arriving while abort correlation is suspended.

## Skill Perspective Check

The `remove-ai-slops` and `programming` skills, including the TypeScript and code-smell references, were explicitly consulted before judging test relevance and maintainability.

- `remove-ai-slops`: violated by the oversized test module; the race tests are not deletion-only or tautological, but their sequencing omits the suspended-window transition and therefore gives incomplete confidence.
- `programming`: violated by the oversized test module and by the async state machine accepting a new user event without transferring generation ownership. No new prompt-string brittleness or untyped escape hatch was found in the reviewed production diff.

## Blockers

1. Preserve or transfer ownership when a new user message arrives during `suspended` state so an older watchdog context cannot be re-armed against the new request.
2. Add a composed regression that sends generation N+1 before deferred generation-N correlation resolves and proves the new request receives its own generation/deadline and is not aborted by the prior timer.
3. Define main-session eligibility from authoritative session identity/lineage, or explicitly account for parent-linked internal sessions, rather than treating every unregistered session as main.
