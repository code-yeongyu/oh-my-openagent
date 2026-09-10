# test

## OVERVIEW
Contract suite for the published launcher: package shape, staged payload, runtime handoff, setup, diagnostics, and signal behavior. Earned a file by its 32-file surface and its real-process verification lane.

## WHERE TO LOOK

| Group | Files | Notes |
|-------|-------|-------|
| Launcher and runtime | `launcher.test.ts`, `compile-entry.test.ts`, `bun-runtime*.test.ts`, `bun-version-probe.test.ts`, `bun-bin-shim.test.ts` | Dispatch, brand env, Bun decision matrix, compiled provisioning, shim upkeep. |
| Process safety | `child-process-signal.test.ts`, `doctor*.test.ts`, `teardown.test-support*.ts` | Signal forwarding and grace, engine classification, retired-payload lines, EBUSY-tolerant cleanup and tracked database closing. |
| State and setup | `agent-dir.test.ts`, `setup-detect*.test.ts`, `setup-import.test.ts`, `sqlite-*.test.ts` | Canonical directory and adoption, cache freshness, credential import, statement-free SQLite discipline. |
| Package and payload | `package-shape.test.ts`, `payload.test.ts`, `packed-install.test.ts`, `senpi-pin.test.ts`, `senpi-patch.test.ts`, `build-info.test.ts` | Bin map and files array, real staged-payload build gate, packed install, exact engine pin, patch behavior. |
| Brand and compat | `brand-contract-pin.test.ts`, `pirate-badge-absence.test.ts`, `anthropic-tool-search-compat.test.ts`, `engine-integrity.test.ts` | Identity, absent-surface, and engine-compatibility contracts. |
| Support | `fixtures/`, `teardown.test-support.ts`, `pty-signal-qa.py`, `tty-driver.py` | Child fixtures, teardown helpers, and the real-pty QA harness. |

## CONVENTIONS

- Tests import launcher modules through their explicit `.js` paths, exercising them the way the shipped launcher loads them.
- Machine-visible contracts are pinned exactly: the bin map, the `files` array, the engine version pin, and the required staged artifacts with their executable modes.
- Payload coverage drives the real build script into a temporary output directory and asserts both completeness failure and success, including that no test files or dev clutter ship.
- Process-level work uses temporary roots and tolerant teardown; database handles are closed through the shared support helpers so Windows cleanup stays deterministic.

## ANTI-PATTERNS

- Do not prove a published-boundary, child-process, pty, or payload contract with a mock; those belong in the real-surface lane that already exists here.
- Do not use fixed sleeps or timing luck for async process state; await the exact exit, event, or state transition.
- Do not leave spawned children, temp roots, or open databases behind, and never let teardown failures pass silently.
- Do not touch the caller's real agent directory or credential stores from a test.
- Do not edit generated payload output to make an assertion pass; rebuild it from source.
