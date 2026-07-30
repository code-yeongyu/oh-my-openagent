# Seventh Exact-Head Review Finding

- Reviewed head: `c919561de234441a42795725cf41a7d00a69ade8`
- Base: `81180f3759c55262a49be6883bb9db5c102e2b4d`
- Reviewer lane: `019f6b7c-ff20-7c61-b9e5-1a1ae5b814c0`
- Verdict before repair: `REQUEST_CHANGES`

## Finding

Generation one retained an acknowledged watchdog-abort token after dispatch.
When generation two armed, the first abort-shaped `session.error` consumed that
older token without knowing which user message owned the event. If the event
was the generation-two user's cancellation and arrived before generation one's
delayed abort, retry state remained owned and generation two later dispatched a
second fallback.

The failing-first proof is
`seventh-review-red-current-cancellation-order.txt` (`Expected 1, Received 2`).

## Repair

An ambiguous abort now suspends the active watchdog and defers normal terminal
handling until the following assistant error update supplies `parentID`.

- An older parent consumes prior-generation provenance, replays the deferred
  error as internal, and resumes the suspended generation.
- The current parent or missing identity clears ownership, replays the deferred
  error as external cancellation, and resets retry state.
- Other progress or terminal events resolve the suspended state without leaving
  a live timer or deferred event behind.

Event translation and decision types were extracted so the primary watchdog
implementation remains at 245 pure lines.

## Verification

- Focused watchdog/event tests: 55 pass, 0 fail.
- Full runtime-fallback suite: 273 pass, 0 fail.
- OpenCode adapter typecheck: pass.
- Scoped Biome and TypeScript no-excuse audit: pass.
- Isolated production-duration OpenCode QA at
  `50ca8e1cc705862b5534b293f83c20ef63da922c`: fallback observed, fallback-owned
  turn did not re-arm the watchdog, later user abort remained external, and the
  real OpenCode database count was unchanged.
