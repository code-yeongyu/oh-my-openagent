# PR #5747 QA evidence

Date: 2026-07-17
Scope: Codex Stop-hook ULW snapshot selection when raw and Codex-scoped snapshots coexist.

## Change verified

`scopedSnapshotSessionIds()` now probes the writer-normalized Codex candidate (`codex-<session>`) before the raw fallback. The regression test exercises the user-facing Stop-hook path with both files present and asserts that the current Codex snapshot is selected while the stale raw snapshot is not surfaced.

## Regression and static checks

- Red proof before the fix: the new Stop-hook regression failed with the raw snapshot selected (`43 tests | 1 failed`).
- Focused reader suite after the fix: `43/43` passed.
- Full `start-work-continuation`: `4 files, 73 tests` passed; TypeScript typecheck passed; Biome lint passed.
- TypeScript no-excuse audit: no violations in the two changed TypeScript files.
- ULW writer snapshot suite: `6/6` passed; ULW typecheck and lint passed.
- `git diff --check`: passed.

## Isolated Codex QA

The common self-check confirmed the Codex binary, sandboxed `CODEX_HOME`, mock-model endpoint, and unchanged real Codex config hash. The hook-unit and app-server probes could not start because this Windows host does not have `jq` or `tmux`; their exit status is recorded in `status.txt`. The repository Docker QA entrypoint also intentionally skips on Windows.

The aggregate `bun run test:codex` harness reached the repository build step but stopped at the existing local Bun multi-entry build error (`Must use --outdir when specifying more than one entry point`). These host/tooling limitations are recorded explicitly; no real Codex configuration was modified.
