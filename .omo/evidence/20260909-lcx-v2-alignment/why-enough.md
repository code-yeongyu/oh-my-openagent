# Why this is enough

The change is limited to the prepared PR D commits: V2 detection alignment in the TypeScript installer, the settled project-local cleanup fixture, and spawn-guard storage-error reporting. The implementation records in `task-d1-doneclaim.json` and `task-d3-doneclaim.json` identify those exact files and acceptance claims.

The permitted-box gate covers the affected installer tests, the ulw-loop spawn-guard test, the generated installer freshness check, and the full plugin build plus aggregate Node contract suite. The only nonzero gate is independently reproduced on the same permitted Linux machine from `dev` and is classified PRE-EXISTING/ENV in `task-gate-d-remote-tests.log`; the branch-specific fixture rerun in that same record passed.

The isolated install checks the shipped bundle rather than only source code. It covers the seeded enabled-V2 regression, the non-enabled control, model and reasoning preservation, removal versus preservation of concurrency settings, all 12 agent TOMLs, and the source manifest hook count. The app-server run exercises the real Codex integration with the local mock model and records both hook lifecycle phases. The raw PreToolUse probe directly covers the new spawn guard allow path in a clean scratch session.

The real `~/.codex/config.toml` is guarded by every codex-qa run and has a ship-time before/after digest pair. No local `bun test` was run, so the remote gate remains the authoritative test-run evidence for this workstation's task constraints.
