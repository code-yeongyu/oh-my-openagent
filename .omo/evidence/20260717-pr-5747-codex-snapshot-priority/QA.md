# PR #5747 QA evidence

Date: 2026-07-17
Scope: Codex Stop-hook ULW snapshot selection when raw and Codex-scoped snapshots coexist.

## Change verified

`scopedSnapshotSessionIds()` now probes the writer-normalized Codex candidate (`codex-<session>`) before the raw fallback. The regression test exercises the user-facing Stop-hook path with both files present and asserts that the current Codex snapshot is selected while the stale raw snapshot is not surfaced.

## Regression and static checks

- Red proof before the fix: the new Stop-hook regression failed with the raw snapshot selected (`43 tests | 1 failed`).
- Focused reader suite after the fix: `43/43` passed.
- Full `start-work-continuation`: `4 files, 74 tests` passed; TypeScript typecheck passed; Biome lint passed.
- TypeScript no-excuse audit: no violations in the five changed TypeScript files.
- ULW writer snapshot suite: `6/6` passed; ULW typecheck and lint passed.
- `git diff --check`: passed.

## Isolated Codex QA

The common self-check confirmed the Codex binary, sandboxed `CODEX_HOME`, mock-model endpoint, and unchanged real Codex config hash. The hook-unit and app-server probes could not start because this Windows host does not have `jq` or `tmux`; their exit status is recorded in `status.txt`. The repository Docker QA entrypoint also intentionally skips on Windows.

The aggregate `bun run test:codex` harness completed the preceding suites with `94 passed, 1 skipped`, then stopped at the existing local Bun multi-entry build error (`Must use --outdir when specifying more than one entry point`) while bundling `components/codegraph`. The hook-unit and app-server probe outputs are captured alongside this file. These host/tooling limitations are recorded explicitly; no real Codex configuration was modified.

## 2026-07-18 non-regular-file guard

`readBoundedText()` now obtains `lstat` metadata before opening a snapshot and accepts only regular files within the existing 32 KiB pre-read limit. This prevents a symlink from being followed to a FIFO, device, or other non-regular object. The existing post-read byte limit remains in place for size races.

- Red proof: `nonregular-file-guard-test-red.txt` records `44 passed, 1 failed`; the simulated non-regular snapshot caused one read before the fix.
- Green proof: focused reader regression `45/45` passed; full `start-work-continuation` suite `4 files, 75 tests` passed; TypeScript typecheck, Biome lint, TypeScript no-excuse, and `git diff --check` passed.
- Codex gate: `nonregular-file-guard-test-codex.txt` records `94 passed, 1 skipped` before the pre-existing codegraph multi-entry Bun build failure. This failure is outside the changed component.
- Isolated Codex checks: `nonregular-file-guard-common-self-check.txt` proves an isolated `CODEX_HOME`, mock model, and unchanged real Codex config. The hook-unit and app-server probes remain blocked before execution by missing host dependencies (`jq`; `tmux` for the hook probe); their outputs are retained in the corresponding `nonregular-file-guard-*.txt` files.
