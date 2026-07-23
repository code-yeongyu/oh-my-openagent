# Fifth Final-Head Review Finding And Repair

## What Was Tested

The goal/constraints reviewer inspected exact head
`b753eb0506d67f3daf2c99f338d0b9e0e196e1dd` against base
`81180f3759c55262a49be6883bb9db5c102e2b4d`. Two failing-first regressions
were then added around the first-prompt watchdog:

- a fallback-owned `role=user` event while `sessionAwaitingFallbackResult` is
  set must not arm a new first-prompt watchdog;
- an abort-shaped `session.error` arriving before the watchdog abort request
  returns success is external cancellation and must invalidate fallback
  dispatch.

The repaired runtime commit is
`dcdbaae5926e66a2165dfde00776c34052fabf61`.

## What Was Observed

- Before the repair, the focused run failed exactly those two cases: the
  fallback-owned event triggered another abort, and the pre-acknowledgement
  abort error still allowed one fallback dispatch.
- After the repair, the focused scope passed `55` tests with `0` failures and
  the full runtime-fallback suite passed `269` tests with `0` failures.
- OpenCode adapter typecheck, scoped Biome, shell syntax, and the scoped
  no-excuse pattern audit passed.
- The exact-runtime-head live OpenCode run passed at the production 90-second
  deadline with unchanged real DB state, one isolated session, visible
  `QA_FALLBACK_OK`, no fallback-owned watchdog re-arm, and the later user abort
  classified as external.

## Why It Is Enough

The generation acknowledgement closes the ambiguous ownership window at the
watchdog boundary: only a successful abort request for the current session
generation can own a subsequent abort event. Removing the generic internal
marker on a pre-acknowledgement abort lets the existing base handler perform
its normal external-cancellation reset. Skipping user events while a fallback
result is already pending prevents the internal retry from creating a second
first-prompt timer. Unit, integrated lifecycle, full hook-suite, and real
server/SSE evidence cover the intended behavior and the adjacent historical
paths.

## What Was Omitted

Raw credentials, auth headers, session identifiers, private paths, and
unfiltered service logs were not recorded. The live harness uses fixed local
dummy credentials and sanitizes the retained event and plugin logs.
