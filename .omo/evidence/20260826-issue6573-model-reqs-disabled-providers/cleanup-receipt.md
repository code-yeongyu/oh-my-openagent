# Cleanup receipt: issue #6573 disabled-provider fallback resolution

## OpenCode

- Candidate and baseline servers used isolated HOME and XDG data/config/state/cache roots.
- Both authenticated server processes were stopped after evidence capture.
- Candidate, baseline, and empty-project sandbox directories were removed.
- An exact database query found zero real session rows for every QA sandbox directory.

## Senpi

- Candidate and pristine-base drivers each used isolated task-owned agent directories.
- Every spawned child PID was terminal after each driver returned.
- All 18 task-owned sandbox roots were removed.
- Both runs reported unchanged real Senpi state and zero leaked PIDs.

## Repository tree

- Build-generated Codex installer noise was restored to `origin/dev`.
- No CodeGraph bundle is part of this repair.
- The only retained generated changes are the three reproducible Senpi extension outputs produced
  by the repository build: `omo.js`, `omo-task.js`, and `memory-run-supervisor.mjs`.
- The generated extension freshness check passes after rebuilding.
- No credentials, auth headers, environment dumps, or machine-local absolute paths are present in
  tracked reviewer evidence.
