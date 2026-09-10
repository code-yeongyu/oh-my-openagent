# Hooks-State Writer Cleanup Evidence

## WHAT WAS TESTED

1. `git grep -n 'spawnSync("kill"'`
   - Established the baseline blast radius before implementation.
2. `git grep -n 'skipIf(process.platform === "win32")' -- script/senpi-hooks-state.test.ts`
   - Confirmed that only the two POSIX mode tests skipped Windows while the legacy truncate/write recovery test remained active there.
3. `bun test script/senpi-hooks-state.test.ts`
   - RED: exercised the new deterministic cleanup-helper tests before adding the Windows branch.
   - GREEN: exercised simulated Windows tree termination, POSIX process-group signaling, survivor detection, and the existing hooks-state scenarios.
4. `bun test script/senpi-hooks-state.test.ts script/senpi-hooks-state-errors.test.ts`
   - Exercised the changed recovery path together with publication and cleanup error handling.
5. `bun run typecheck:script`
   - Typechecked every top-level `script/*.ts` file with the repository's script project.
6. The programming-skill no-excuse audit and pure-line count.
   - Checked the changed TypeScript for forbidden escape hatches and measured the file at 234 pure lines.

## WHAT WAS OBSERVED

### RED

The simulated Windows test failed because the POSIX-only implementation never invoked `taskkill.exe`:

```text
error: expect(received).toEqual(expected)

- [
-   {
-     "args": [
-       "/PID",
-       "4242",
-       "/T",
-       "/F",
-     ],
-     "command": "taskkill.exe",
-   },
- ]
+ []

- Expected  - 11
+ Received  + 1
```

The full RED output is in `red.txt`.

### GREEN

```text
9 pass
0 fail
14 expect() calls
Ran 9 tests across 1 file. [689.00ms]
```

The full GREEN output is in `green.txt`.

The paired regression run passed 12 tests with 20 assertions. `bun run typecheck:script` exited 0. The TypeScript no-excuse audit reported no violations.

The final helper:

- invokes `taskkill.exe /PID <pid> /T /F` for simulated `win32`;
- sends `SIGTERM` to `-pid` for POSIX process-group termination;
- polls the writer PID with a bounded 20-attempt verification;
- returns `{ phase: "verify-exit", pid }` only after the PID is dead;
- throws a typed cleanup error carrying the failed phase and PID when termination or verification fails;
- is awaited before `rmSync(root, ...)`, so the temporary root is not removed before writer death is verified.

The baseline repository scan found exactly one `spawnSync("kill"` call:

```text
script/senpi-hooks-state.test.ts:56:        if (writerPid !== undefined) spawnSync("kill", ["-TERM", `-${writerPid}`])
```

The same baseline file skipped Windows only at lines 101 and 109:

```text
script/senpi-hooks-state.test.ts:101:  test.skipIf(process.platform === "win32")("preserves an existing POSIX snapshot mode under a restrictive umask", () => {
script/senpi-hooks-state.test.ts:109:  test.skipIf(process.platform === "win32")("creates a new POSIX snapshot with mode 0600 under a permissive umask", () => {
```

The recovery test itself remains enabled on Windows. Its 60,000 ms test budget, 10,000 ms child timeout, and assertions are unchanged.

## WHY IT IS ENOUGH

The RED result proves the regression test distinguishes the old POSIX-only command selection from the required Windows behavior. The GREEN result proves both platform branches and the phase-and-PID survivor failure deterministically without requiring a Windows host. The existing recovery test proves the helper is wired into the ETIMEDOUT path, while the paired error suite and script typecheck cover adjacent behavior and type safety.

The PID verification is part of the helper's success contract, and temporary-root removal occurs only after the awaited success report. This directly covers the leaked-writer and held-lock risk.

## WHAT WAS OMITTED

- No real Windows runner was available; the Windows branch was verified through the requested injected command and liveness seams.
- The editor LSP attached to the parent workspace could not resolve Bun/Node modules for this nested worktree and reported the same environment-wide import errors across `script/`. The authoritative `bun run typecheck:script` project check passed.
- Raw environment dumps, credentials, tokens, auth headers, and unrelated build logs were not captured.
- `bun install --frozen-lockfile` installed dependencies but its automatic prepare build later failed while initializing local shared-skill submodules because Git disallowed the local `file` transport. The requested tests and typecheck ran successfully from the worktree after dependency installation.
