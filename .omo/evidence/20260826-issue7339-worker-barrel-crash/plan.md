# Plan - issue #7339: omo-task worker creation can crash host before barrels load

## Root cause (two independent holes on the worker-creation surface)

### Hole 1 - pi-tui boundary in the omo-task.js bundle is never warmed (regression from bb2af9c96)

- `omo.js` and `omo-task.js` are SEPARATE bun bundles. Each inlines its own copy of
  `packages/senpi-task/src/lazy/pi-tui.ts`, so the memoized `piTuiModule` state is per-bundle.
- bb2af9c96 moved the single `await loadPiTui()` from `createTaskComponent().register()` into
  `composeOmoSenpiExtension` to cover omo.js-resident consumers (fallback-architect notice,
  memory renderers). That fixed omo.js's copy but left the omo-task.js copy cold.
- With no in-graph caller of `loadPiTui()` left, the bundler dead-code-eliminated the loader and
  constant-folded the guard: built omo-task.js contains `function Ld(){throw Error("The
  @earendil-works/pi-tui barrel was accessed before it was loaded...")}` and ZERO
  `import("@earendil-works/pi-tui")`. Every synchronous pi-tui access from omo-task.js now throws,
  unconditionally.
- Crash chain (matches the issue stack): worker creation -> store mutation ->
  `statusUi.scheduleSync()` -> 250 ms debounce timer -> `renderCachedRecords()` ->
  `buildWidgetRows`/`backgroundWidgetRows` -> `excerptRendererText`/`rendererVisibleWidth`
  (renderer-text.ts) -> `piTui()` -> throw inside `Timeout._onTimeout` -> uncaught -> host exits.

### Hole 2 - senpi barrel read at DAG run creation with no awaited load

- `dag start` -> `createDagManager.start` -> `startRun` -> `materializeSkills` (manager.ts:342)
  -> component loader chain (`createTaskSkillLoader` -> `createFsSkillLoader`) ->
  `senpiBarrel().loadSkillsFromDir(dir)` SYNCHRONOUSLY (tools/task/skills.ts:126).
- Nothing on that path awaits `loadSenpiBarrel()`: that await lives on the task-tool execute path
  (execute.ts:81, execute-single.ts:71) and inside `InProcessRunner.start` - both run later or not
  at all for process-mode nodes. Any node with `load_skills` throws "The @code-yeongyu/senpi barrel
  was accessed before it was loaded" BEFORE dispatch. `amend` rematerializes too (same hole).

## Fix (minimal, at the root)

1. Fix A: restore `await loadPiTui()` inside `createTaskComponent().register()` (after the
   member-process guard, before any registration). Warms the omo-task.js copy and keeps the loader
   alive against DCE. compose's warm-up STAYS (it covers omo.js-resident consumers). Update the
   stale comments in lazy/pi-tui.ts + extension/compose.ts: each bundle embedding the lazy module
   must warm its own copy at its own registration entry point.
2. Fix B: in `createDagManager`, await `loadSenpiBarrel()` before `startRun`/`amendRun` when a
   `materializeSkills` option is present. This is the async entry point leading to the sync barrel
   read; matches the documented lazy-barrel pattern. Update skills.ts comment.
3. Regenerate tracked extension bundles (`node packages/omo-senpi/plugin/scripts/build-extension.mjs`)
   so shipped artifacts match source; omo-task.js must again contain the pi-tui dynamic import.

## TDD

- Probe A (fresh `bun run` process, preloads ignored): register ONLY createTaskComponent against a
  fake API (compose NOT involved), then drive the status-UI timer render path. RED: throws the
  pi-tui barrel error; GREEN after Fix A.
- Probe B (fresh process): createDagManager + real createDagSkillMaterializer (default fs loader),
  start a definition whose node has load_skills. RED: start() rejects with the senpi barrel error;
  GREEN after Fix B.
- Bundle assertion: built plugin/extensions/omo-task.js must contain import("@earendil-works/pi-tui").
  RED today (loader DCE'd), GREEN after rebuild.

## Gates

- Focused tests x2 consecutive clean runs (new tests + neighboring suites).
- `bunx tsgo --noEmit -p packages/senpi-task/tsconfig.json` and `-p packages/omo-senpi/tsconfig.json`.
- `git diff --check`; hygiene scan of changed files.
- QA: live senpi harness UNAVAILABLE (no senpi binary) - documented as blocker. Artifact-level QA:
  drive the REBUILT omo-task.js in an isolated /tmp sandbox with stubbed peer externals through
  register + timer render + dag-less task spawn surface; prove isolation (sandbox-only paths).

## Out of scope

- No refactor of the dag-runtime deep-relative imports, no changes to member bundle, no new warm-ups
  beyond the two fixes.
