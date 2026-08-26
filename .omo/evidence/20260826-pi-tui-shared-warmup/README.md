# pi-tui warm-up shared across duplicated bundle copies

Branch: `fix/senpi-task-pi-tui-shared-warmup` (base `dev`, 8c57e463e)

## Symptom

A live omo-ai session running `mass-ulw` died with:

```
OmO exiting due to uncaughtException:
Error: The @earendil-works/pi-tui barrel was accessed before it was loaded. Await loadPiTui() ...
    at ... plugin/extensions/omo-task.js ...
    at Array.flatMap
    at Timeout._onTimeout
```

## Root cause

`omo-task.js` is built as its own bundle (`plugin/scripts/build-extension.mjs`, `#omo-task-runtime`
alias in `src/extension/bundled-index.ts`). It carries a private copy of
`packages/senpi-task/src/lazy/pi-tui.ts`, whose warm-up state was module-local. `compose.ts:111`
awaits `loadPiTui()` through the `omo.js` copy only, so the `omo-task.js` copy stayed cold. The DAG
status widget (`components/task/dag-status-ui.ts:98`, `setTimeout` driven `runs.flatMap(runRows)`)
reads pi-tui synchronously via `senpi-task/renderer-text` and threw outside any try/catch.

## Fix

`lazy/pi-tui.ts` keeps `{module, promise}` on `globalThis[Symbol.for("omo.senpi-task.piTui")]`,
so one warm-up satisfies every bundle copy in the process.

## What was tested

1. RED then GREEN: `bun test packages/senpi-task/src/lazy/pi-tui-shared-state.test.ts`
   - Imports the module twice (second via query-suffixed specifier = independent instance), warms
     through the first, reads through the second.
   - RED (before fix): `expect(received).not.toThrow()` failed with the exact production message
     "The @earendil-works/pi-tui barrel was accessed before it was loaded..."
   - GREEN (after fix): 1 pass, 3 expect() calls.
2. Existing cold-process regression: `bun test packages/omo-senpi/src/extension/compose-cold-pi-tui.test.ts` -> 1 pass.
3. Typecheck: `bunx tsgo --noEmit -p packages/senpi-task/tsconfig.json` and
   `-p packages/omo-senpi/tsconfig.json` -> no output (clean).
4. Bundle structure: after `node packages/omo-senpi/plugin/scripts/build-extension.mjs`,
   `grep -c 'omo.senpi-task.piTui'` -> omo.js: 1, omo-task.js: 1, omo-member.js: 0
   (member bundle has no pi-tui reader; expected).

## Why it is enough

The crash is a module-instance identity problem, not a timing problem; the test reproduces the
identity split directly and fails with the production error text. The bundle grep proves the fix
reached both shipped copies. Remaining risk: a future bundle that reads pi-tui without any warm-up
path in-process still throws by design (the guard is intentional).

## Bundle regeneration

Windows-built `omo.js` differs from the ubuntu CI build (stale-output failure precedent, PR #7082).
Bundles committed on this branch are produced in the WSL Linux clone `~/omo` with bun 1.4.0 and
`bun install --frozen-lockfile`; see `wsl-build.log` in this directory.

## Omitted

No secrets involved. The WSL clone listing contained an unrelated repository remote with an embedded
token; it was not copied into this evidence.
