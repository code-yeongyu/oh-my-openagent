# Plan: issue 6580 cmux completion delivery repair

## Root causes

1. `ParentNotifier.enqueue` reported coordinator admission as delivery success. Native notification
   could fire before the batched host steer was accepted, and asynchronous host rejection was invisible
   to durable completion retry bookkeeping.
2. Direct `sendMessage` Promise rejection was ignored, so native success could be emitted for a failed
   internal delivery.
3. The bridge cached a missing cmux executable permanently, split UTF-16 surrogate pairs at its body
   cap, and did not expose the default detached-process diagnostic policy to deterministic tests.
4. Bun 1.4 emits equivalent hoisted top-level function declarations in nondeterministic order. Terser
   assigned identifiers from that order, making exact generated-artifact freshness checks flaky.

## Change set

1. Make `ParentNotifier.enqueue` return an optional delivery Promise and keep `(task_id, epoch)` in
   flight until it settles. Persist `notified_epoch` only after acknowledgement; route rejection into
   the existing bounded retry ladder.
2. Resolve coordinator receipts only from `onFlushed` and reject from `onDeliveryFailed`. For direct
   sends, chain cmux notification from Promise fulfillment. Never emit cmux on internal rejection.
3. Cache only successful cmux discovery, preserve Unicode boundaries, and expose typed detached-process
   diagnostics while retaining failure isolation.
4. Canonicalize only top-level hoisted function declarations before Terser minification. Preserve
   imports, classes, variables, effectful statements, exports, and shebangs in their original contract.
5. Rebuild only build-owned Senpi extension artifacts and remove unrelated Codex generated churn.

## Verification

- Failing-first completion, bridge, and build-determinism regressions.
- Focused completion/adapter tests, full senpi-task package, full `test:senpi`, both package typechecks,
  no-excuse scan, diff hygiene, and two independent extension freshness checks.
- Real Senpi task lifecycle driver with isolated home/process evidence and exact-current-base comparison
  for any residual driver failure.
- P0-P3/noise audit followed by final Opus review before commit and push.
