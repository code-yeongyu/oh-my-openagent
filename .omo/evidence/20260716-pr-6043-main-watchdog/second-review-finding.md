# Second Exact-Head Review Finding

Reviewed head: `9126722bd6e4d447c41d1d56cad9959d620a1e01`

## Finding

The watchdog observer runs before the base runtime-fallback event handler.
During a watchdog-owned abort, an OpenCode `session.error` could therefore call
`onSessionTerminal()` before the base handler consumed
`internallyAbortedSessions`. The watchdog exempted marked internal
`session.idle`, but not the equivalent marked internal `session.error`, so the
session generation was invalidated and fallback dispatch was suppressed.

## Failing-First Proof

Command:

```text
bun test packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog-lifecycle.test.ts
```

Observed before the production fix:

```text
4 pass
1 fail
Expected: 1
Received: 0
```

The failing case drove an internal abort marker, delivered `session.error`
while the abort promise was pending, consumed that marker through the real
base event handler, then resolved the abort.

## Repair And Regression Boundary

Runtime head `be630fc68e47b3c522556c3aec026c9b5c270247` exempts marked internal
`session.error` from watchdog cancellation, matching the existing internal
`session.idle` treatment. The integrated test also proves that an explicit
`session.stop` remains terminal even while the internal-abort marker is set.

Post-fix results are captured in `second-review-repair-focused-tests.txt` and
`second-review-repair-runtime-fallback-suite.txt`.
