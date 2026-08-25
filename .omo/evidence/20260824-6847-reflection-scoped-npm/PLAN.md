# Plan: fix #6847 memory reflection ENOENT on scoped npm Windows installs

Branch: issue/6847-memory-reflection-scoped-npm (base dev @ 8833800ae)

## Root cause

`packages/omo-native/bin/lib/package-paths.js`, `nearestNodeBin()` (lines 49-63 at base):
the walk returns the FIRST EXISTING `node_modules/.bin` without checking that it contains
the executable shim. On Windows scoped npm installs, npm materializes
`...\omo-ai\node_modules\@code-yeongyu\senpi\node_modules\.bin` even when it holds no
shims, and it shadows the ancestor `...\omo-ai\node_modules\.bin\senpi.cmd`.

Consequence chain in `bin/lib/launcher.js` `senpiEnvironment()`:
1. `nearestNodeBin(senpiRoot)` returns the empty scoped bin.
2. That dir is prepended to the child PATH.
3. The launcher deletes inherited `SENPI_BIN` and recomputes it, but
   `join(binDir, "senpi.cmd")` does not exist there, so `SENPI_BIN` stays absent.
4. Memory reflection children fall back to spawning bare `senpi`, which resolves nowhere
   on PATH: `spawn senpi ENOENT`, repeated on every reflection boundary.

## Fix direction

`nearestNodeBin(startPath, options)` gains `{ executable?, platform?, fileExists? }`:
a candidate bin qualifies only if it holds the platform shim for the executable
(`<name>.cmd` on win32, `<name>` elsewhere). Injected platform/fileExists keep the
decision testable portably (pattern from merged #7205 `resolveWindowsCmdPath`).
`launcher.js` passes `{ executable: "senpi" }`. No-executable calls keep the legacy
first-existing-bin walk; when no bin carries the shim the function returns undefined,
which leaves PATH and SENPI_BIN untouched instead of pointing at a dead directory.

## Files

1. EDIT packages/omo-native/bin/lib/package-paths.js - shim-aware nearestNodeBin + private hasBinShim.
2. EDIT packages/omo-native/bin/lib/launcher.js - pass { executable: "senpi" } (#6847 comment).
3. NEW packages/omo-native/test/package-paths.test.ts - unit suite, injected platform cases.
4. EDIT packages/omo-native/test/launcher.test.ts - FixtureOptions.scopedEmptyBin + e2e regression
   asserting SENPI_BIN and the PATH head survive an empty scoped .bin.

## Verification

- Failing-first: both new suites RED before implementation (logs in this directory).
- bun test packages/omo-native/test green; tsc -p packages/omo-native/tsconfig.json --noEmit exit 0.
