# Twenty-fourth review finding: resolved SDK abort errors

Date: 2026-07-17
PR: #6043
Reviewed evidence head: `fbdc88a30d6c3532d6d9c60d73ab47d81dd8275a`
Integrated runtime source: `da10bb68a791be0a104c32f00f9d6acbf09a56b9`

## What was tested

- The code/concurrency review traced `createAbortSessionRequest()` through the
  pinned `@opencode-ai/sdk@1.15.13` generated client.
- A failing-first unit case made `session.abort()` resolve with the SDK's
  non-throwing error shape: `{ data: undefined, error, response: 404 }`.
- The test reserved the session before the abort and asserted the helper's
  boolean outcome, internal-abort ownership, and prompt reservation.

## What was observed

- The generated SDK defaults `ThrowOnError` to `false`. A non-2xx abort can
  therefore resolve with a populated `error` instead of rejecting.
- Before the repair, the new test failed with `expected false, received true`;
  the focused file reported 6 passing tests and 1 failing test.
- The old helper ignored the resolved result, released the prompt reservation,
  retained internal abort ownership, and returned success even though the HTTP
  abort failed.
- The repair passes `throwOnError: true` and also rejects a populated resolved
  `result.error` defensively. On either failure form it clears internal abort
  ownership, preserves the reservation, logs the failed decision, and returns
  `false`.
- After the repair, the focused file reports 7 passing tests, 0 failures, and
  12 assertions. The regression test also proves `throwOnError: true` reached
  the client call.

## Why it is enough

The failing-first case reproduces the exact generated SDK contract missed by
the integrated source and asserts every state transition that could otherwise
cause a false retry takeover. The remaining gate is a wire-level run against
the real pinned SDK plus the full runtime/lifecycle and isolated OpenCode QA;
those outputs are captured as separate twenty-fourth artifacts.

## What was omitted

No secrets, auth headers, environment dumps, or private logs are included.
