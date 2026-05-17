# ADR: prompt-async-gate - reservation-based duplicate-injection guard

## Status

Accepted (introduced in v4.2.0)

## Context

Issue #4012 reported duplicate streaming output after OMO injected an
internal message into a live OpenCode session.

The user-visible failure was two assistant bubbles streaming the same
continuation.

The root race was not one hook making one bad decision. Multiple internal
routes could observe the same idle, completion, or error edge and each decide
that the parent session needed a wake or recovery prompt.

The most important race window was:

1. OpenCode emitted a `session.idle` event.
2. OMO started an `isSessionActive` HTTP poll.
3. OpenCode was still pacing the streaming animation for the previous answer.
4. The poll observed an inactive or idle-looking session.
5. OMO injected a continuation prompt.
6. A second hook observed the same edge and injected again.
7. The user saw two assistant bubbles.

The historical race site was visible in the built bundle at
`dist/index.js:69665-69680`. That code checked session activity before sending
an internal prompt, but the check and the prompt were not protected by a
shared reservation.

OpenCode's `prompt_async` route contributed to the failure mode because it has
fire-and-forget semantics. `session.promptAsync` can resolve before the prompt
is durably accepted by the target session. A later `session.error` event can
still arrive for the same attempt, so the caller can believe dispatch finished
while a recovery hook still treats the session as eligible for retry.

OMO has 13+ internal hook callers that can inject prompts, including:

- background task parent wakes
- runtime fallback retries
- model suggestion retries
- team mailbox live delivery
- session recovery continuations
- todo continuation resumes
- CLI run resumes
- Claude Code hook injections
- sync subagent prompts
- background subagent prompts

Route-local guards cannot close this race. Each route can be correct in
isolation and still collide with another route in the same process.

The root `AGENTS.md` now records the governing invariant in the section
"Internal message injection is dangerous": production code may call
`session.prompt` or `session.promptAsync` only inside
`src/shared/prompt-async-gate.ts`. Every other route must use the shared gate.

## Decision

Create `src/shared/prompt-async-gate.ts` as the single production owner of raw
OpenCode prompt dispatch.

The gate exposes the public wrappers that production callers must use:

```ts
export function promptAsyncAfterSessionIdle(
  options: PromptAsyncAfterSessionIdleOptions,
): Promise<PromptAsyncGateResult>

export function promptAfterSessionIdle(
  options: PromptAfterSessionIdleOptions,
): Promise<PromptAsyncGateResult>
```

The gate coordinates callers with a module-global reservation map:

```ts
const reservations = new Map<string, Reservation>()
```

The map is keyed by `sessionID`. A reservation records the source that claimed
the session, an expiration time, and a `Symbol(source)` token. The token gives
each reservation identity beyond its text source.

Every caller supplies a stable `source` string such as:

```ts
const source = `background-agent:${taskID}`
```

The shared flow is:

1. Prune expired reservations.
2. Reserve the session before waiting or dispatching.
3. Wait for the idle settle period.
4. Poll session activity unless the route has a proven opt-out.
5. Dispatch through the selected OpenCode prompt API.
6. Keep the reservation during the post-dispatch hold.
7. Release after the hold or through an explicit recovery path.

The reservation is taken before the activity poll so that two hooks cannot both
enter the poll-dispatch window.

The default post-dispatch hold is exported as:

```ts
export const DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS = 250
```

`postDispatchHoldMs` defaults to 250 ms. The gate holds the reservation briefly
after the dispatch attempt even when dispatch throws synchronously or returns a
failed result. This closes the AGENTS.md hazard where `promptAsync` returns
before durable acceptance and a late OpenCode error races with retry logic.

The default dispatch timeout is 30 seconds:

```ts
export const DEFAULT_PROMPT_DISPATCH_TIMEOUT_MS = 30_000
```

`dispatchTimeoutMs` wraps the underlying `session.promptAsync` or
`session.prompt` call with `Promise.race`. A hung OpenCode API call must fail
closed instead of holding a reservation forever.

Both public gate helpers delegate to one internal runner:

```ts
dispatchAfterSessionIdle<TInput>(args)
```

`promptAsyncAfterSessionIdle` passes a `session.promptAsync` dispatcher.
`promptAfterSessionIdle` passes a `session.prompt` dispatcher. Sharing the
runner keeps reservation, hold, timeout, logging, and active-session behavior
identical for async and sync prompt routes.

The public gate result is a discriminated union. Callers must treat `active`
and `reserved` as successful suppression, not automatic retry signals. A route
that changed optimistic task or loop state before dispatch owns restoring that
state when the gate returns `failed`, `unavailable`, or a skipped status that
requires rollback.

The gate exposes `releasePromptAsyncReservation` for intentional recovery
paths. Prefix release is deliberately tight:

```ts
export function releasePromptAsyncReservation(
  sessionID: string,
  options?: {
    reservedBy?: string
    reservedByPrefix?: string
  },
): boolean

releasePromptAsyncReservation(sessionID, {
  reservedByPrefix: "runtime-fallback:",
})
```

`reservedByPrefix` must end in `:`. This prevents broad releases such as
`runtime` matching unrelated sources. Exact source release remains available
for callers that know the full reservation source.

Raw prompt calls outside the gate are blocked by
`src/shared/prompt-async-route-audit.test.ts`. The audit uses the TypeScript
Compiler API rather than regex so it catches destructuring, bracket access,
optional chaining, and aliased or cast access patterns.

## Consequences

### Positive

- Duplicate internal prompt injection now has one reservation winner per
  session.
- The post-dispatch hold closes the AGENTS.md "returns before durably
  accepted" hazard even when dispatch errors synchronously.
- Dispatch timeout prevents a stuck OpenCode call from holding the gate forever.
- 13+ internal hook callers share one result model and one safety primitive.
- The AST-based audit from HIGH-5 catches more bypass shapes than the prior
  regex audit.
- Route-specific tests can focus on route behavior while the shared gate tests
  reservation semantics.

### Negative

- Caller-side retry logic that releases and retries must call
  `releasePromptAsyncReservation` explicitly when the original prompt did not
  durably reach the server. `src/shared/model-suggestion-retry.ts` is the
  reference case.
- 13+ wiring sites each need to be conscious of the gate result. Treating
  `reserved` as a failure can create noisy retries.
- A valid retry can be delayed by the default 250 ms post-dispatch hold.
- The reservation map is process-local. It protects OMO hooks in the current
  plugin process, not every possible OpenCode process.

### Migration

Existing `session.prompt` and `session.promptAsync` callers must route through
`promptAfterSessionIdle` or `promptAsyncAfterSessionIdle`.

Existing production callers were wired through the introduction PR #4034.

The AST-based audit fails CI if a raw prompt call is added without an allowlist
entry. Any allowlist entry must explain why the raw access is not a dispatch
route or why it is still gate-routed.

New internal message routes must include duplicate-injection regression tests
for their trigger. Static policy alone is not enough.

### Future work

- Replace prefix-tightened release with full Symbol-token-based release
  ownership. This is the HIGH-7 deferred work.
- Define same-source concurrent caller handling. Some routes may need collapse
  semantics by source rather than by session only.
- Add dispatch metrics for observability, including reservation win, reserved
  skip, active skip, timeout, and failed dispatch counts.
- Consider cross-process coordination if OpenCode exposes a durable session
  lock or idempotency key.

## References

- Issue #4012: duplicate streaming output and two assistant bubbles.
- PR #4034: introduction of `prompt-async-gate`.
- Commit `b333a5280`: `fix(prompt-async-gate): add dispatch timeout, shared runner, harden prefix release`.
- Commit `8c4cc09de`: `test(prompt-async-route-audit): migrate to TypeScript AST walker`.
- Commit `ff1b15d53`: `fix(model-suggestion-retry): release reservation before retry attempt`.
- Commit `f93d7297c`: `test(prompt-async-gate): cover dispatch timeout and post-dispatch error hold`.
- PR #3866 -> PR #4053: schema-compatible synthetic tool results for
  post-compaction recovery, related to safe recovery dispatch.
- Root `AGENTS.md`: section "Internal message injection is dangerous".
- `.omo/rules/test-discipline.md`: forbids `setTimeout(resolve, N)` and
  `await sleep(N)` in tests unless time itself is the system under test.
- Implementation: `src/shared/prompt-async-gate.ts`.
- Audit: `src/shared/prompt-async-route-audit.test.ts`.
