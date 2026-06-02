# Changelog

## [0.1.0] - unreleased

- Initial scaffold of codex-ulw-loop plugin.
- Per-Criterion Cycle: `EXECUTE` is now **EXECUTE-AS-SCENARIO** — the agent must run the Manual-QA channel scenario the criterion named (HTTP call / tmux / browser use / computer use; see new `## Manual-QA channels` section). Inserted a new **CLEAN (PAIRED, NEVER SKIP)** step that tears down every QA-spawned process / `tmux` session / browser context / container / port / temp dir before recording evidence; the cleanup receipt is embedded in the `--evidence` string. Missing receipt → record BLOCKED, not PASS. Added Constraint #13 and a Stop Rule for leftover state.
- New top-level **`## Manual-QA channels`** section explicitly enumerates the four channels (HTTP call, tmux, Browser use, Computer use) with concrete commands and required artifacts. Goal section now declares **TESTS ALONE NEVER PROVE DONE**: a green test suite is supporting evidence, never completion proof. Criterion-refinement step 2 requires each criterion to name its channel up front.
