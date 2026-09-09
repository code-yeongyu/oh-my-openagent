# omob: never prune a dev runtime that a live process is executing

## Symptom
Memorian gate in an omob session: `ENOENT ... /Users/yeongyu/.omo/binary-runtime/0.0.0-omob.749b777.eab8c4b/plugin/extensions/memorian-persona.md`.

## Root cause
`~/.local/bin/omob` (auto-update launcher) runs `build-omob.ts --if-changed --binary-only --keep 2` on every launch.
When origin/dev or origin/main advanced, it rebuilt twice today (11:18, 11:23) and `pruneOmobRuntimes` deleted
`0.0.0-omob.749b777.eab8c4b` while PIDs 84145 (since 09-08 23:37) and 54720 (since 09-09 01:17) were still executing
`<that dir>/omo`. The compiled runtime reads persona assets lazily (`memory-core/src/recall/assets/assets.ts`
`readFileSync(join(ASSETS_DIR, "memorian-persona.md"))`), so the first memorian judge after the prune hit ENOENT.
Every other lazily-read asset (skills, personas, sidecars) has the same exposure.

## Fix
1. New `script/omob-runtime-prune.ts` (extracted: build-omob.ts is 413 pure LOC, over the ceiling):
   - `PruneEntry`, `isOmobRuntimeDir`, `selectPruneEntries` moved unchanged.
   - `planRuntimePrune(entries, keep, currentVersion, inUse)` excludes in-use runtimes before budgeting.
   - `runtimesInUse(runtimeRoot, names, processCommands)`: a runtime is in use when any live process command
     starts with `<runtimeRoot>/<name>/`.
   - `listProcessCommands()`: `ps -axo command=` on POSIX, `Get-Process` paths on win32; typed
     `ProcessListUnavailableError` when the listing fails.
   - `pruneOmobRuntimes(keep, currentVersion)` moved; skips in-use dirs (logged) and skips pruning entirely when the
     process list is unavailable (never delete blind).
2. `build-omob.ts` imports `pruneOmobRuntimes` from the new module; prune tests move to `omob-runtime-prune.test.ts`.

## Verification
- RED: new tests fail before the module exists / before the inUse parameter exists.
- GREEN: `bun test script/omob-runtime-prune.test.ts script/build-omob.test.ts` remotely (mengmotaMac or gorky).
- Mutation: drop the inUse filter -> exclusion test fails while others pass.
- Real surface: spawn a process from a fake `~/.omo/binary-runtime/0.0.0-omob.x.y/omo` under a temp HOME, run
  `pruneOmobRuntimes` with keep=1 for a different current version -> the in-use dir survives, an idle one is deleted.
- typecheck:script + biome on changed files.
