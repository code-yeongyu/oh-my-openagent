# Tenth Exact-Head Review Finding

- Reviewed head: `fc5bddb025f0106e40ebcf1ec486914da069f41d`
- Reviewer: `019f6be7-aa57-7362-8896-d59b072443a9`
- Verdict: `FINDING HIGH` / `REQUEST_CHANGES`

## Finding

While an abort-shaped `session.error` was suspended for assistant-parent
correlation, a following `session.idle` unconditionally resolved the deferred
terminal. The base runtime-fallback handler then replayed the abort without
internal ownership and reset a newer active generation's accepted fallback
state before the assistant event carrying the old parent ID arrived.

The observed OpenCode ordering was:

```text
session.error -> session.idle -> assistant message.updated
```

The existing composed regression omitted the intervening idle event.

## Repair

Runtime commit `423022fb1f3a8df2a34c07193e22e0a9677d7432` keeps a
suspended correlation intact across `session.idle`. Other terminal events
retain their existing cancellation behavior, and ordinary idle processing can
still run through the base hook.

The regression in
`packages/omo-opencode/src/hooks/runtime-fallback/hook-progress-delayed-terminal.test.ts`
now reproduces the live ordering and asserts that the accepted fallback model
remains unchanged.

## Verification

- Red proof: `tenth-review-red-idle-before-correlation.txt`
- Focused watchdog tests: 56 pass, 0 fail
- Shared session-status timeout tests: 3 pass, 0 fail
- Full runtime-fallback suite: 276 pass, 0 fail
- OpenCode adapter typecheck: pass
- Scoped Biome and no-excuse audits: pass
- Production-duration isolated OpenCode QA: fallback observed, no fallback
  watchdog re-arm, later user abort external, real database unchanged
