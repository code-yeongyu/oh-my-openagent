# ADR: Prompt Async Gate

## Status

Accepted for v4.2.0.

This decision applies to every production route that sends an internal message
through an OpenCode session API.

The mandated implementation is `src/shared/prompt-async-gate.ts`.

The root `AGENTS.md` invariant named "Internal message injection is dangerous"
is the policy authority for this ADR.

The static audit `src/shared/prompt-async-route-audit.test.ts` enforces the
production side of this decision.

Route-specific tests must still prove behavior for each internal message path.

## Context

Issue 4012 reported duplicate streaming output after internal message injection.

The visible symptom was repeated assistant output in a live parent session.

The underlying failure mode was a race between OpenCode session state and OMO
continuation hooks.

OMO has several routes that can decide to wake or continue a session:

- background task completion notifications
- runtime fallback retries
- team mailbox delivery
- recovery continuations
- CLI run resume paths
- Claude Code hook delivery
- sync and background subagent prompts

These routes can observe the same idle, completion, or error edge.

Without a shared gate, two routes can dispatch the same internal prompt into the
same parent session.

OpenCode also exposes a subtle durability gap.

`session.promptAsync` can return before the prompt is durably accepted by the
target session.

A later `session.error` event can still arrive for the same attempt.

That means a route can think it finished while another hook still sees the
session as eligible for recovery.

The old pattern was unsafe:

```ts
await client.session.promptAsync({
  path: { id: sessionID },
  body: { text: message },
})
```

The unsafe properties were:

1. No per-session reservation before dispatch.
2. No shared active-session check.
3. No post-dispatch hold for late failures.
4. No timeout around a hung dispatch.
5. No central log trail for skipped or failed dispatches.
6. No static audit that could block new raw prompt routes.

Local guards inside each feature were not enough.

Different hooks can run in the same process and see different snapshots of
session state.

They need one shared reservation map keyed by session ID.

The root `AGENTS.md` now states the invariant:

```text
Treat every session.prompt / session.promptAsync call as a write to shared
session state. Production code may call them only inside
src/shared/prompt-async-gate.ts.
```

This ADR records the architecture behind that invariant.

## Decision

All production internal message injection must go through
`src/shared/prompt-async-gate.ts`.

The module exports two gate functions:

```ts
export async function promptAsyncAfterSessionIdle<TInput>(args: {
  client: PromptAsyncClient<TInput>
  sessionID: string
  input: TInput
  source: string
  settleMs?: number
  postDispatchHoldMs?: number
  dispatchTimeoutMs?: number
  checkStatus?: boolean
}): Promise<PromptAsyncGateResult>

export async function promptAfterSessionIdle<TInput>(args: {
  client: PromptClient<TInput>
  sessionID: string
  input: TInput
  source: string
  settleMs?: number
  postDispatchHoldMs?: number
  dispatchTimeoutMs?: number
  checkStatus?: boolean
}): Promise<PromptAsyncGateResult>
```

The gate returns a discriminated result instead of throwing for expected races:

```ts
export type PromptAsyncGateResult =
  | { status: "dispatched"; response: unknown }
  | { status: "active" }
  | { status: "reserved"; reservedBy: string }
  | { status: "unavailable" }
  | { status: "failed"; error: unknown }
```

Callers must treat `active` and `reserved` as successful suppression.

They mean another actor owns the session or the user is already active.

They are not retry signals by default.

Every call must provide a stable `source` string.

The source identifies the route that reserved the session.

Recommended source format:

```ts
const source = `background-agent:${taskID}`
```

The reservation flow is:

1. Prune expired reservations.
2. Reject if the session already has an active reservation.
3. Reserve the session before waiting or dispatching.
4. Wait for idle settle time.
5. Check current session status unless the caller opted out for a proven reason.
6. Dispatch through `session.promptAsync` or `session.prompt`.
7. Keep a short post-dispatch hold after an attempted dispatch.
8. Release only after the hold expires or through an intentional recovery path.

The default timing constants are part of the decision:

```ts
export const DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS = 250
export const DEFAULT_PROMPT_DISPATCH_TIMEOUT_MS = 30_000
```

The post-dispatch hold is required because `promptAsync` returning does not prove
that all related OpenCode events have drained.

The dispatch timeout is required because a stuck OpenCode API call must not hold
the reservation forever.

The timeout is a circuit breaker, not a synchronization primitive.

Callers must not set `postDispatchHoldMs: 0`.

The static audit rejects that pattern.

If a caller needs custom behavior, it must add a route-specific regression test
that proves duplicate dispatch cannot occur.

The gate owns the raw prompt calls:

```ts
const promptAsync = client.session?.promptAsync

if (typeof promptAsync !== "function") {
  return { status: "unavailable" }
}

return dispatchAfterSessionIdle({
  sessionName: "promptAsync",
  client,
  sessionID,
  input,
  source,
  settleMs,
  postDispatchHoldMs,
  dispatchTimeoutMs,
  checkStatus: args.checkStatus !== false,
  dispatch: (dispatchInput) => promptAsync(dispatchInput),
})
```

Production code outside this module must not access these APIs directly:

```ts
client.session.prompt(...)
client.session.promptAsync(...)
client["session"]["promptAsync"](...)
const { promptAsync } = client.session
Reflect.apply(client.session.promptAsync, client.session, [input])
```

Type guards may check that `promptAsync` exists when the eventual dispatch still
routes through the shared gate.

The allowlist in the audit must stay small and justified.

The gate also exposes reservation release helpers for intentional recovery:

```ts
releasePromptAsyncReservation(sessionID, {
  reservedBy: "model-suggestion-retry",
})

releasePromptAsyncReservation(sessionID, {
  reservedByPrefix: "runtime-fallback:",
})
```

Prefix release is allowed only for prefixes that end with `:`.

This prevents broad accidental releases such as `runtime` matching unrelated
sources.

Release helpers exist for rollback and retry flows.

They must not be used as a normal cleanup path after dispatch.

## Consequences

Positive consequences:

- Duplicate internal dispatches collapse to one reservation winner.
- Late `session.error` events no longer trigger immediate duplicate retries.
- Internal message routes share logging and result semantics.
- Tests can reason about a single gate instead of many ad hoc guards.
- New raw prompt routes are blocked by a static audit.
- Retry flows can release only their own reservation source.
- Hung dispatches fail closed through a timeout.

Negative consequences:

- Internal prompt injection has a small default latency from idle settling.
- A post-dispatch hold can delay a legitimate retry by 250 ms.
- Callers must handle `PromptAsyncGateResult` instead of assuming dispatch.
- Tests that mock session APIs may need to model reservation state.
- Any new route must add route-specific duplicate-injection coverage.

Operational consequences:

- CI green is not enough for race fixes tied to issue 4012.
- Maintainers must re-run the documented reproducer against the fix commit.
- Logs containing `[prompt-async-gate]` are the first place to inspect when a
  wake, retry, or recovery message does not appear.

Testing consequences:

- `src/shared/prompt-async-gate.test.ts` covers gate behavior.
- `src/shared/prompt-async-route-audit.test.ts` blocks raw production prompt
  routes.
- Route owners must add regression tests for the specific trigger they wire.
- Tests must not rely on sleeping to wait for the post-dispatch hold.

Design constraints that remain open:

- The reservation map is process-local.
- Cross-process OpenCode sessions still rely on the session API and event stream.
- The gate does not deduplicate different semantic prompts for the same session.
- The gate prevents concurrent injection, not incorrect caller intent.

Rejected alternatives:

1. Keep route-local guards.

   This failed because hooks observe the same edge from different modules.

2. Disable recovery on any recent prompt event.

   This would hide valid recovery paths and lose task state.

3. Use a global fixed delay after every dispatch.

   A delay without a reservation does not prevent another route from entering.

4. Treat `promptAsync` success as durable acceptance.

   Issue 4012 showed that later OpenCode errors can still arrive.

5. Allow raw prompt calls with code review discipline.

   The risk is architectural, so the invariant needs an automated audit.

Migration rule:

```ts
const result = await promptAsyncAfterSessionIdle({
  client,
  sessionID,
  input,
  source: "runtime-fallback:retry",
})

if (result.status === "failed") {
  restoreOptimisticState()
}
```

The caller owns any optimistic task or loop state it changed before dispatch.

If dispatch is skipped, unavailable, or failed, the caller must restore state
when needed.

## References

- Issue 4012: https://github.com/code-yeongyu/oh-my-openagent/issues/4012
- Introduction PR 4034: https://github.com/code-yeongyu/oh-my-openagent/pull/4034
- Hardening commit: `b333a5280` `fix(prompt-async-gate): add dispatch timeout, shared runner, harden prefix release`
- Test commit: `f93d7297c` `test(prompt-async-gate): cover dispatch timeout and post-dispatch error hold`
- Retry release commit: `ff1b15d53` `fix(model-suggestion-retry): release reservation before retry attempt`
- Root invariant: `AGENTS.md`, section `Internal message injection is dangerous`
- Implementation: `src/shared/prompt-async-gate.ts`
- Static audit: `src/shared/prompt-async-route-audit.test.ts`
