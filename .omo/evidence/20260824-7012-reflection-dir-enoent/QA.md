# QA evidence: #7012 reflection ENOENT when runtime/reflection-sessions is missing

Date: 2026-08-25
Branch: issue/7012-reflection-dir-enoent (base: dev @ 8833800ae)
Scope: packages/omo-senpi/src/components/memory/identity-runtime.ts (+ its colocated test)
only.

## WHAT WAS TESTED

1. Failing-first regression test, written before the implementation
   (identity-runtime.test.ts, "memory identity runtime first-write seam"): builds a fresh
   identity via buildIdentityPaths with NO runtime directory created anywhere (the exact
   fresh-machine shape from #7012; every pre-existing suite mkdir'd these dirs first,
   which masked the bug), reserves a manual run through the identity runtime's own
   ReflectionReservationStore, drives runtime.launch(), and asserts
   runtime/reflection-sessions exists afterwards.
2. Scoped suite after the implementation: bun test
   packages/omo-senpi/src/components/memory (green-memory-suite.txt).
3. Typecheck: bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json, exit 0
   (typecheck.txt).

## WHAT WAS OBSERVED

- RED before the fix (red-identity-runtime-first-write.txt): only the new case failed -
  after launch completed, runtime/reflection-sessions was still absent
  ("Expected: true, Received: false"); the 4 pre-existing cases in the file passed.
- GREEN after the fix: the same file passes 5/5; the whole memory component suite runs
  901 pass / 6 skip / 0 fail across 133 files; typecheck exit 0.
- The fix: createIdentityRuntime now guarantees ensureIdentityRuntimeDirs (mkdir
  recursive over every identity runtime dir incl. reflectionSessions) once, lazily, and
  awaits it at the start of every launch before runner.launch can build the lazy sandbox;
  MemoryIdentityRuntime.launch now returns Promise<void> so callers/tests can await it.
  Reconcile revivals ride the same wrapped closure.

## WHY IT IS ENOUGH

- The regression test reproduces the reporter's precondition exactly (payload machinery
  never ran, no runtime dir exists) and pins the maintainer-endorsed option 1 seam: dirs
  are guaranteed before the sandbox that grants runtime/reflection-sessions as a writable
  is built, so bwrap never receives an absent --bind source and seatbelt grants name real
  directories on every platform.
- The assertion targets the directory the issue names, and the fixture deliberately skips
  the mkdir every neighboring suite performs, so the test cannot silently pass by fixture
  accident.
- The full memory component suite (907 tests) guards the surrounding reflection/facts/
  wiring behavior against regressions from the launch-path change.

## WHAT WAS OMITTED

- Live senpi harness QA was not driven for this change: the touched surface is the
  parent-side launch seam exercised hermetically above; no hook, tool, config schema, or
  installer surface changed. Residual risk recorded here per the evidence contract.
- bun install prepare step fails/hangs in this environment (git submodule fetch network);
  known harmless env quirk also recorded by PR #7231. Dependencies resolved via
  `bun install --ignore-scripts`; the pre-existing dirty submodule flag on
  packages/shared-skills/upstreams/designpowers predates all edits and is NOT part of
  this change. Nothing under packages/shared-skills/upstreams/* or plugin dist artifacts
  is staged.
- No secrets, tokens, or host-identifying paths appear in the captured outputs; fixture
  paths live under the OS temp dir.

Additional local QA note: package-wide bun test reached 2209 pass / 1 skip / 24 unrelated pre-existing failures; focused changed test and typecheck passed.
