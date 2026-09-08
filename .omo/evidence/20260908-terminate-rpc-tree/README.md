# terminateRpcChild process-tree termination evidence

Date: 2026-09-08

## What was tested

- RED baseline under 12 `yes` CPU-load loops: the requested 20-run command reached the target suite but produced no lines because the test had 0 failures; the initial empty capture was replaced by the required raised-load run.
- RED raised-load run: 20 executions under 24 `yes` loops, captured in `red-under-load.log`. All 20 observations are `0` failures.
- Deterministic RED variant: a temporary fixture mode made the parent exit immediately on SIGTERM while its descendant ignored SIGTERM. Under 24 `yes` loops, run 38 failed before the fix; the raw output is in `red-deterministic-under-load.log`.
- GREEN target test: `bun test packages/senpi-task/src/runners/rpc/terminate.test.ts` -> 5 pass, 0 fail.
- GREEN raised-load run: the same 20-run command under 12 `yes` loops, captured in `green-under-load.log`. It contains exactly 20 lines, each `0`.
- Package regression suite: `bun test packages/senpi-task` -> 1967 pass, 1 skip, 0 fail.
- Typecheck: `bunx tsgo --noEmit -p packages/senpi-task/tsconfig.json` completed successfully.
- Static checks: Biome and LSP diagnostics reported no issues for both changed TypeScript files.
- Bundle build: `node packages/omo-senpi/plugin/scripts/build-extension.mjs` completed and regenerated `packages/omo-senpi/plugin/extensions/omo-task.js`.

## What was observed

Before the fix, `terminatePosixProcessGroup` sent SIGKILL and awaited only the direct child's exit event. The deterministic RED output records the observable race under load: the immediate-assertion variant failed on run 38, with the parent termination path reaching `signalProcessGroup` while the descendant race was active.

After the fix, the POSIX path polls `processGroupExists(pid)` every 10 ms for up to 2000 ms after SIGKILL, and the direct-child escalation path uses the same bounded observation of `hasExited(child)`. The test assertion uses a bounded 10 ms state-change poll up to 2 seconds rather than an immediate sample.

## Why this is enough

The evidence covers the reported timing-sensitive POSIX process-tree race, the direct-child fallback path, the full `senpi-task` package regression suite, strict package typechecking, and the generated extension consumed by the plugin. The post-SIGKILL observation is bounded, so a pathological process state cannot make termination hang indefinitely.

## Omitted

- Windows `taskkill` semantics were intentionally unchanged, as required by scope.
- No other `senpi-task` modules or `omo-senpi` sources were changed.
- No fixed sleep was added to the production code or test; all waits are bounded state-change observations.
