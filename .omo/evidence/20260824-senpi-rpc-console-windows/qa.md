# Senpi task RPC console windows on Windows (#6857) - QA evidence

## Root cause (precise)

`packages/senpi-task/src/runners/rpc-process.ts`, `defaultSpawnChild()` (the default
`spawnChild` seam of `RpcProcessRunner`, wired from `RpcProcessRunnerOptions.spawnProcess ??
spawn` in the constructor): the Senpi/Node console-subsystem executable was spawned with piped
stdio but without `windowsHide`. On a console-less Windows host, a console-subsystem child
without `windowsHide` allocates a fresh visible console window for the RPC child lifetime.

Independent of the memory-supervisor path (#6849 / #6850).

## Disposition: fix already merged on dev

The production fix pre-exists on this branch's base (dev @ 8833800ae):

- Commit `81b6551d6` "fix(senpi-task): hide RPC child windows on Windows" (2026-08-14, 8 minutes
  after issue creation) added `windowsHide: true` to `defaultSpawnChild`.
- PR #6858 (state MERGED into `dev` at 2026-08-16T21:41Z, merge commit `94e95472`) delivered the
  full fix plus the Windows probe harness (`rpc-process.windows.test.ts`,
  `rpc/__fixtures__/windows-console-*`).
- Both commits are ancestors of this branch's HEAD; verified with
  `git merge-base --is-ancestor`.

Issue #6857 remained OPEN only because GitHub auto-close fires on merges to the DEFAULT branch:
#6858 targeted `dev`, and neither its body nor its commits carried a `Fixes #6857` closing
keyword. No open PR referenced the issue (checked via `gh pr list --search 6857` and the issue
timeline: single cross-reference event from #6858).

## WHAT TESTED

1. Contract regression test (platform-agnostic):
   `bun test packages/senpi-task/src/runners/rpc-process.test.ts`
   - "#given the default RPC child spawner #when started #then Windows hides the child console"
     injects `spawnProcess`, captures the real options built by `defaultSpawnChild`, and asserts
     `{ stdio: ["pipe","pipe","pipe"], shell: false, windowsHide: true,
     detached: process.platform !== "win32" }` (rpc-process.test.ts:81-86).
2. Full package gate: `bun test packages/senpi-task`
3. Typecheck: `./node_modules/.bin/tsgo --noEmit -p packages/senpi-task/tsconfig.json`
4. Windows live probe coverage reviewed on disk (skipped on Linux by design,
   `test.skipIf(!isWin32)`): visible-control vs hidden-fixed arms through an `AllocConsole` +
   `FreeConsole` detached parent, asserting visible control window, hidden production child with
   `MainWindowHandle == 0`, stdio round-trip, credential digests untouched, whole-tree teardown.

## WHAT WAS OBSERVED

- `bun test packages/senpi-task/src/runners/rpc-process.test.ts`: 12 pass, 0 fail.
- `bun test packages/senpi-task`: 1742 pass, 1 skip (the win32-only probe), 0 fail, exit 0.
- Typecheck: exit 0.
- Current spawn options at rpc-process.ts:109-120 carry `windowsHide: true`, `shell: false`,
  piped stdio, `detached: process.platform !== "win32"`.

## Failing-first deviation (explicit)

A failing-first red run could NOT be produced on this base: the fix is already an ancestor of
HEAD, so reverting it would mean weakening nothing and re-testing already-shipped code out of
tree. Per the task fallback, the platform-agnostic test asserting that the spawn options include
the hide flags EXISTS and is green (rpc-process.test.ts:68-87), and the win32 live probe pins the
observable outcome (no visible window, MainWindowHandle == 0). This PR therefore adds no
duplicate behavioral test; it encodes the load-bearing rationale as a comment at the spawn site
so the flags survive future refactors, and closes the issue-linkage gap.

## WHY IT IS ENOUGH

- The exact contract the issue demands is pinned twice: options-level (cross-platform, runs in
  CI on every push) and observable-window-level (win32 probe, runs on windows runners).
- The full senpi-task suite (246 files, incl. runner, respawn, terminate paths) is green, so no
  other spawn path regressed.
- The remaining defect was administrative (issue never linked), addressed by this PR body ending
  with `Fixes #6857`.

## WHAT WAS OMITTED

- The win32 live probe was not executed here: this QA host is Linux; the probe self-reports SKIP
  off-windows and the merged #6858 evidence records its PASS on Windows runners
  (WINDOWS_CONSOLE_PROBE + WINDOWS_TASK_RPC_E2E in PR #6858's workflow run 31972441218).
- `bun install` prepare step failed in this environment (git submodule fetch network reset +
  frontend materialization build); documented as a known harmless env quirk. Dependencies
  resolved; all scoped tests ran. Nothing from `packages/shared-skills/upstreams/*` is staged.
- No secrets, tokens, or env dumps are included; no credential material was read or written.
