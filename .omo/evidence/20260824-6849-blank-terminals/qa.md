# QA evidence - issue #6849 memory supervisor blank terminals

Date: 2026-08-24
Branch: `issue/6849-memory-supervisor-blank-terminals` (base dev @ `8833800ae`)
Host: Linux x86_64 (see "Platform limitation" below)

## WHAT WAS TESTED

Commands (run from the worktree root):

1. Failing-first proof of the regression test, with the production fix temporarily reverted via
   `git stash push -- packages/omo-senpi/src/components/memory/worker/memory-run-supervisor.ts`:

   ```sh
   bun test packages/omo-senpi/src/components/memory/worker/windows-console-hide.test.ts
   ```

2. Same command after restoring the fix (`git stash pop`).

3. Scoped worker suite (the worker AGENTS.md gate):

   ```sh
   bun test packages/omo-senpi/src/components/memory/worker
   ```

4. Package typecheck (root package.json `typecheck:packages` step for omo-senpi):

   ```sh
   ./node_modules/.bin/tsgo --noEmit -p packages/omo-senpi/tsconfig.json
   ```

Behavior under test: the supervisor bootstrap spawn in
`packages/omo-senpi/src/components/memory/worker/memory-run-supervisor.ts` must derive detachment
from the runtime platform (`detached: platform !== "win32"`) instead of staying `detached: true`
everywhere, per the no-window contract in issue #6849 (model child `windowsHide: true`; bootstrap on
Windows non-detached + hidden; bootstrap on POSIX keeps its detached process group). The audit test
`windows-console-hide.test.ts` pins this by parsing every `spawn(...)` call site in the chain files.

## WHAT WAS OBSERVED

1. Failing-first (fix reverted): `1 fail / 3 pass`. The new test
   "#then the bootstrap spawn derives detachment from the runtime platform instead of staying
   detached everywhere" failed with `Expected to contain: 'detached: platform !== "win32"'`,
   received the HEAD spawn options containing `detached: true`. Exit code 1.
2. With the fix restored: `4 pass / 0 fail` (7 expect calls) in that file.
3. Full scoped worker suite: `221 pass / 0 fail`, 1094 expect() calls, 35 files (~99s).
4. Typecheck: exit code 0, no diagnostics.

Raw captured output: `verification.log` in this directory.

## WHY IT IS ENOUGH

- The failing-first run proves the new tests actually pin the fixed behavior; they fail against the
  pre-fix source and pass against the fix.
- On POSIX the change is a behavioral no-op (`platform !== "win32"` is always true there, identical
  to the previous `detached: true`), so the 221 passing worker tests - including the IC8 suite that
  exercises BOTH platform paths through the `OMO_MEMORY_SUPERVISOR_PLATFORM` test seam
  (supervisor-process-identity.ts) - cover the win32 spawn-options path logically on this host.
- The fix mirrors the already-reviewed senpi-task RPC child pattern from PR #7196 /
  commit `81b6551d6` (#6857): `windowsHide: true` plus win32 non-detachment.
- Remaining regression risk: actual window suppression on a real Windows desktop (Windows Terminal
  default-terminal allocation) cannot be observed from this Linux host; see limitation below.

## PLATFORM LIMITATION (win32 runtime)

This evidence was produced on a Linux host. The user-visible symptom of #6849 (a blank Windows
Terminal window titled `senpi` flashing per reflection/facts run) can only be reproduced on Windows.
No live Windows QA was run. The win32-specific runtime probe pattern that would cover it exists for
senpi-task (`packages/senpi-task/src/runners/rpc-process.windows.test.ts`,
`test.skipIf(!isWin32)` AllocConsole parent + `MainWindowHandle == 0` assertion) but has no memory
supervisor counterpart yet; adding one is out of scope for #6849 as filed.

## WHAT WAS OMITTED

- No live Senpi harness QA (`senpi-qa` drivers): the defect is win32-only console allocation and the
  host is Linux; the hermetic unit gate above is the applicable verification here.
- No secrets appear in the captured output. GitHub auth material, environment dumps, and absolute
  home paths are absent from `verification.log`; only repo-relative paths and public repo names
  (`code-yeongyu/oh-my-openagent`) occur.
- Pre-existing dirty submodule `packages/shared-skills/upstreams/designpowers` was left untouched
  and is not part of this change.
