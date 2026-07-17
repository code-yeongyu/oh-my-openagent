# PR #6043 Timeout Generation Repair Evidence

## Source Identity

- Runtime source parent: `23a3420573d4db152cde6fb547416f572685436c`.
- Committed runtime source: `e13ad8773de0d95134c8128bb1f1e45e2525d97c`.
- Integrated base: `8af398565abfaece6d5fc3e6bc4ef0c7efa9bb7a`.
- Exact committed three-file diff SHA-256: `11723cf4e7c98d8613992bf2804d93266648f6e6600fcb63bb4dd2e5a99d14eb`.

## What Was Tested

1. A fallback timeout begins aborting an old request, then a newer user generation starts before the abort resolves.
2. The stale completion must not dispatch, clear the newer retry owner, remove the replacement timeout, or mutate fallback state.
3. The same interleaving through the composed `createRuntimeFallbackHook()` surface.
4. The full runtime-fallback suite, repository typecheck, scoped Biome lint, no-excuse audit, pure-LOC ceiling, and committed-diff integrity.
5. The production-duration isolated OpenCode watchdog path through the real adapter, HTTP API, SSE, and local fake provider.

## What Was Observed

- Failing-first helper test: the pre-repair callback dispatched one stale fallback after the generation advanced.
- Focused repaired matrix: `9 pass`, `0 fail`, including helper owner/timer preservation and composed-hook non-dispatch.
- Full runtime-fallback suite: `364 pass`, `0 fail` across 58 files.
- Typecheck, scoped Biome lint, no-excuse, source diff, and pure-LOC gates passed.
- Changed files remain at 102, 224, and 233 pure LOC.

## Why It Is Enough

The deterministic tests pause the abort at the exact asynchronous boundary that exposed the race, advance the real shared session generation, install a newer owner and timer, and then release the stale completion. The production-duration run separately proves the repaired committed source still executes through the real OpenCode adapter without polluting live user state.

## Omitted

The live harness does not artificially pause OpenCode's abort response to inject a concurrent user turn; that adversarial ordering is deterministic in the helper and composed-hook tests. Raw secret-bearing logs, authorization headers, temporary sandbox paths, and private credentials are not retained.
