# Plan: fix #7012 reflection ENOENT when runtime/reflection-sessions is missing

Branch: issue/7012-reflection-dir-enoent (base dev @ 8833800ae)

## Root cause

`createIdentityRuntime` (`packages/omo-senpi/src/components/memory/identity-runtime.ts`,
`lazySandbox` at lines 81-106 at base) grants the reflection sandbox `runtimeWrites`
including `identityPaths.reflectionSessions`. The repo's first-write seam
`ensureIdentityRuntimeDirs` (`context.ts:51`) mkdir -p's every identity runtime dir
including `reflectionSessions`, but the reflection launch path never runs it:
`launch -> runner.launch -> executeReflectionRun -> runReflectionChild -> lazySandbox`.
`prepareReflectionSpawn` only mkdirs `<runtime>/reflection/runs/<runId>` (a different
tree), so `<runtime>/reflection-sessions` can still be absent at sandbox-build/spawn time.
Commit 12c176e02 already stopped the sandbox build itself from throwing (walk-up
canonicalPath), but on Linux bwrap still cannot `--bind` an entry that does not exist
("Can't find source path"), so a fresh identity's first reflection dies pre-spawn with
spawn_failed. The maintainer diagnosis on #7012 names option 1: call
`ensureIdentityRuntimeDirs` before building the reflection sandbox.

## Fix direction

In `createIdentityRuntime`, guarantee the identity runtime dirs once, lazily, and await
that guarantee at the start of every launch, before `runner.launch`. `launch` returns the
underlying promise (`Promise<void>`) so callers and tests can await completion; it keeps
its internal catch, so fire-and-forget callers are unchanged. Reconcile revivals ride the
same wrapped closure. No sandbox-platform changes; scope stays the missing-directory
problem.

## Files

1. EDIT packages/omo-senpi/src/components/memory/identity-runtime.ts - lazy
   ensureRuntimeDirsOnce + awaited launch; MemoryIdentityRuntime.launch returns
   Promise<void>.
2. EDIT packages/omo-senpi/src/components/memory/identity-runtime.test.ts - new
   failing-first regression case: fresh identity with NO runtime dirs, manual reservation
   through the runtime's own store, launch, then assert runtime/reflection-sessions exists.

## Verification

- Failing-first: new test RED before the implementation (log in this directory).
- Scoped suite green after: bun test packages/omo-senpi/src/components/memory/identity-runtime.test.ts,
  then the whole memory component dir.
- Typecheck: tsgo --noEmit -p packages/omo-senpi/tsconfig.json exit 0.
