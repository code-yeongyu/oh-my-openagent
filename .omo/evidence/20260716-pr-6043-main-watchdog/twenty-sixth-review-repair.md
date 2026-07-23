# PR 6043 twenty-sixth review repair

## Finding

The final code-review lane found two HIGH abort-ownership races at source head
`ab69cdfb02b687bef9563d3e84195941d6740db4`.

1. OpenCode can publish the watchdog abort event before the abort HTTP response
   resolves, while generation provenance was recorded only after that response.
   The event could therefore cancel the watchdog before fallback dispatch.
2. Overlapping same-session internal abort callers issued separate wire aborts
   and acquired separate terminal ownership, although OpenCode may publish one
   terminal transition for the session. The next genuine user cancellation
   could then be consumed as stale internal ownership.

Failing-first `abort-wire-ordering.test.ts` reported 0 pass / 2 fail: the early
event produced no `consume-terminal` decision, and two overlapping callers
issued two wire aborts.

## Repair

Source commit `69c41c05481cbf7eb1dae55e57cb711fede845c3`:

- reserves exact watchdog-generation provenance before abort I/O;
- marks only the pending abort-response window as eligible for early internal
  event consumption;
- rolls the reserved provenance back when cancellation fails;
- coalesces overlapping internal abort callers for one session onto one wire
  request and one ownership; and
- clears the in-flight request map during hook disposal.

## Exact-head verification

- Focused ordering, ownership, lifecycle, and generation races: 21 pass / 0
  fail (`twenty-sixth-exact-focused-regressions.txt`).
- Full runtime fallback: 300 pass / 0 fail across 47 files
  (`twenty-sixth-exact-runtime-fallback-suite.txt`).
- Model fallback, plugin lifecycle, and session state: 66 pass / 0 fail
  (`twenty-sixth-exact-session-lifecycle-suite.txt`).
- Static gates: `tsgo --noEmit`, no-excuse audit, documented Biome lint-only
  check, `git diff --check`, and pure-LOC audit all pass. The central watchdog
  remains exactly 250 pure lines.
- Pinned `@opencode-ai/sdk@1.15.13` loopback: HTTP 404 returns false, clears
  internal abort ownership, preserves the exact prompt reservation, and sends
  no sibling model-fallback prompt
  (`twenty-sixth-exact-sdk-abort-boundary.txt`).
- Mandatory isolated real OpenCode QA: two active roots were observed; the
  older silent root recovered through watchdog fallback; deleting the newer
  root restored the older root; fallback success did not re-arm the watchdog;
  a later user abort remained external; and the real DB count stayed 5751
  (`twenty-sixth-exact-live-*`).

## Why this is enough

The deterministic tests force both disputed interleavings at the production
helper and event-observer seams without timing assumptions. The SDK probe covers
the actual cancellation transport failure contract. The live server/SSE run
covers plugin loading, production watchdog timing, fallback dispatch, root
lifecycle, later cancellation, process cleanup, and database isolation.

## Omitted or bounded

No secrets, auth headers, raw environments, private credentials, or unrelated
logs are copied. The live server does not intentionally coalesce two concurrent
HTTP abort requests; that ownership boundary is proven deterministically by the
production helper regression instead.
