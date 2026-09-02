# Evidence: issue 6580 cmux completion delivery

## What was tested

- Failing-first completion tests for deferred coordinator delivery, direct asynchronous rejection,
  in-flight deduplication, retry/reconcile races, displaced receipts, durable retry, and exactly-once
  native notification after acknowledgement.
- Failing-first bridge tests for retry after a missing executable, default-process diagnostics,
  Unicode-safe truncation, multiline details, and final-response file metadata.
- Failing-first bundle tests for Bun 1.4 top-level function ordering, executable shebang preservation,
  effectful statement ordering, artifact tamper detection, and exact freshness checks.
- `bun test packages/senpi-task`
- `bun run test:senpi`
- `tsgo --noEmit -p packages/senpi-task/tsconfig.json`
- `tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
- Two independent `build-extension.mjs --check` runs.
- Real Senpi 2026.9.2 `task-e2e.mjs` runs on the rebased branch and exact clean base `4480fd41a`.

## What was observed

- Reviewed-head delivery red: four intended failures from premature notification persistence and
  cmux emission. Reviewed-head bridge red: three intended failures at discovery retry, default
  process diagnostics, and Unicode truncation.
- Build freshness red: isolated extension tests reproduced two stale-output failures; the direct
  canonicalization regression failed before the fix. Runtime probes showed identical Bun inputs
  producing two byte variants that differed only in hoisted top-level function declaration order.
- Focused completion, coordinator, parent, and cmux tests: 106 pass, 0 fail.
- Senpi task package: 1,806 pass, 1 skip, 0 fail, 5,906 expectations across 255 files.
- Full Senpi gate: 2,555 pass, 7 skip, 0 fail, 8,122 expectations across 337 files; evidence resolver
  10 pass, 0 fail, 31 expectations.
- Both package typechecks exited 0. Generated extension checks passed twice independently.
- Real Senpi completion, batching, error routing, cancellation, cleanup, and isolation checks passed.
  Six lifecycle assertions failed identically on the branch and exact clean base. Both runs reported
  an untouched real Senpi home and zero leaked PIDs.

## Why this is sufficient

The notifier now treats adapter admission and host delivery as separate states. Durable notification
bookkeeping advances only after the coordinator or direct host Promise acknowledges delivery;
rejections retain the existing bounded retry path. Native cmux notification follows that same receipt,
so internal rejection cannot produce an orphan success notification. Bridge tests cover its process,
discovery, diagnostic, formatting, and Unicode boundaries. The bundle fix canonicalizes only hoisted
function declarations before minification; effectful statement order remains significant and exact
artifact integrity checks remain enabled.

The real-driver check map is identical on exact clean base, which proves the six remaining lifecycle
assertions are not introduced by this branch. Detailed live artifacts are stored locally under the
ignored directory `.omo/evidence/omo-senpi-adapter/20260902-pr-7386-cmux-delivery/`; the tracked
summary remains reviewer-readable without machine-local output.

## What was omitted

- Native rendering inside cmux.app cannot be observed on this Linux host. The production launch path,
  argv, diagnostics, formatting, and failure isolation are exercised with controlled process ports.
- Raw machine-local paths, environment dumps, credentials, tokens, and private configuration are not
  copied into tracked evidence.
