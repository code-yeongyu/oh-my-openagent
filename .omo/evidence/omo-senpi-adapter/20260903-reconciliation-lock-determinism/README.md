# Reconciliation Lock Determinism QA

## WHAT WAS TESTED

The scheduler-lock deferral contract was tested at the reconciliation boundary.
The focused suite exercised both forms of contention introduced by this pull
request: a sibling bind with a readable owner record and the injected
`contendedReservation(lockPath, null)` seam that models the Windows
ambiguous-owner `EPERM` case. The sibling-lock case also exercised the
post-release liveness assertion at
`packages/omo-senpi/src/components/memory/worker/run-reconciliation.test.ts:63`.
After the outer `withLock(...)` callback released the scheduler lock, a normal
reconciliation had to return the failed orphan result rather than `[]`.

The following surfaces were driven from the pull request worktree:

- Negative-control RED run:
  `bun test packages/omo-senpi/src/components/memory/worker/run-reconciliation.test.ts`
  after temporarily removing the null-owner scenario's
  `deferOnSchedulerContention: true`, followed by restoration of the committed
  test.
- GREEN focused run:
  `bun test packages/omo-senpi/src/components/memory/worker/run-reconciliation.test.ts`.
- Core lock run: `bun test packages/memory-core/src/locks`.
- Adapter typecheck: `bun run --cwd packages/omo-senpi typecheck`.
- Real isolated harness run:
  `SENPI_BIN="$(command -v senpi)" node packages/omo-senpi/scripts/qa/drive.mjs`.

Raw outputs are stored beside this file in `red-focused-test.log`,
`green-focused-test.log`, `memory-locks.log`, `omo-senpi-typecheck.log`, and
`senpi-live-driver.log`.

## WHAT WAS OBSERVED

The negative control failed for the intended contract violation. Without
deferral enabled, the injected reservation rejected the non-immediate state
read:

```text
error: scheduler contention must use an immediate lock attempt
(fail) reflection and dream run reconciliation > #given the scheduler owner is unreadable on Windows #when reconciliation defers #then reservation state is not mutated [175.48ms]

 9 pass
 1 fail
 36 expect() calls
Ran 10 tests across 1 file. [2.48s]
```

After restoring the deferral option, the exact GREEN summary was:

```text
bun test v1.3.14 (0d9b296a)

 10 pass
 0 fail
 38 expect() calls
Ran 10 tests across 1 file. [2.49s]
```

The memory-core lock suite reported 19 pass, 0 fail, 55 expectation calls
across 4 files. The omo-senpi package typecheck exited 0 after invoking
`tsgo --noEmit -p tsconfig.json`.

The real Senpi driver reported `result: "PASS"`,
`ultraworkInjected: true`, and `commentChecker: "PASS"`. Its isolation fields
reported `realSenpiUntouched: true`, `realOmoUntouched: true`, empty changed
path arrays, and unchanged protected state for both real homes. The driver
used its own temporary `sandboxAgentDir`; neither `~/.senpi/agent` nor
`~/.omo/agent` was used as the QA sandbox.

## WHY IT IS ENOUGH

The injected null-owner reservation deterministically reproduces the result of
the Windows path where filesystem contention is known but owner metadata
cannot be read. It verifies that `LockContentionError` still collapses to `[]`
without mutating the active reservation. The phase watchdog bounds the
outer-lock, deferral, and post-release phases independently, so a lock-order
regression fails with a named phase instead of hanging. The liveness assertion
then proves the contention result is not cached: once the outer scheduler lock
is released, the real reservation store completes reconciliation normally.

Together, those checks cover the Windows flake's semantics without depending
on host-specific lock timing. The core lock suite checks the underlying lock
implementation, the package typecheck checks the TypeScript contract, and the
real Senpi driver proves the adapter still loads and runs in an isolated agent
home.

## WHAT WAS OMITTED

Native `windows-latest` execution was not available locally and is covered
only by CI. Per instruction, CI was not awaited. No secrets, tokens, auth
headers, credential contents, or environment dumps were captured. The live
driver output contains only its sanitized result and isolation metadata.
