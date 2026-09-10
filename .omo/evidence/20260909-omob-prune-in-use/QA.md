# QA — omob runtime prune keeps in-use runtimes

## What was tested
1. Unit/contract: `bun test script/omob-runtime-prune.test.ts script/build-omob.test.ts` on mengmotaMac
   (bun 1.4.0, detached worktree `/tmp/omob-prune-20260909` at 0d6ff537b + the 4 changed files, sha-verified
   after pushTree, `bun install --frozen-lockfile` exit 0).
2. Mutation: dropped `&& !inUse.has(entry.name)` from `planRuntimePrune` (grep confirmed 0 remaining
   `inUse.has` in the mutant), re-ran the prune test file, restored the original (sha
   38d6b713e1907bca5c7f927140b810c7e3540a92fcae209773c35d0d1a647960 matches local).
3. Real surface (mengmotaHost, `bun /tmp/omob-live-qa.ts`, log in `live-process-qa.log`): temp runtime root with
   two dev runtime dirs whose `omo` symlinks to the bun executable; a child is spawned from
   `<root>/0.0.0-omob.live000.live000/omo` and its `ready` line awaited; then `pruneOmobRuntimes({keep:1,
   currentVersion:<other>})` runs with the REAL `ps -axo command=` listing (no injected commands).
4. `bun run typecheck:script` (tsgo) clean; `bunx biome check` on the 4 files exit 0.

## What was observed
1. GREEN: `26 pass / 0 fail / 57 expect()` across 2 files (`/tmp/omob-prune-green.log` on mengmotaMac).
2. Mutant: `10 pass / 2 fail` — exactly the two tests that name the in-use guard failed
   (`planRuntimePrune > never prunes a runtime a live process executes...`,
   `pruneOmobRuntimes > deletes idle runtimes beyond the budget but keeps one a live process executes`); all
   other tests still passed, so the failure is specific to the guard.
3. Live: `pruned dev runtime 0.0.0-omob.idle000.idle000` + `kept in-use dev runtime 0.0.0-omob.live000.live000`;
   `{"kept":["0.0.0-omob.live000.live000"],"liveExists":true,"idleExists":false}`.
4. No type or lint findings.

## Why it is enough
The defect is "prune deletes a runtime a live process executes". The contract test locks the planner, the
`runtimesInUse` tests lock whole-dir-name matching, the `listProcessCommands` test proves a live child shows
up under its absolute exec path on this platform, and the live QA proves the composed function with the real
process listing keeps the occupied dir while still retiring idle ones. The mutation shows the tests fail
without the guard. `build-omob.ts` only changed its import and the call site; its remaining tests still pass.

## What was omitted
- Windows `Get-Process` path listing is implemented but not executed here (no Windows box in the compute pool);
  the POSIX branch is the one every omob host uses today. Root `bun test` on the Windows CI lane runs the test
  file, including the live-child `listProcessCommands` test.
- No omob rebuild was run inside QA; the launcher path is exercised after merge (see summary).
