# Changelog

## [0.1.0] - unreleased

- Initial scaffold of codex-ultragoal plugin.
- Per-Criterion Cycle: `EXECUTE` is now **EXECUTE-AS-SCENARIO** — the agent must actually invoke the real surface (HTTP via `curl -i`, terminal / TUI via `tmux new-session` + `send-keys` + `capture-pane`, GUI via computer-use / Playwright, CLI stdout, DB diff). Inserted a new **CLEAN (PAIRED, NEVER SKIP)** step that tears down every QA-spawned process / `tmux` session / browser context / container / port / temp dir before recording evidence; the cleanup receipt is embedded in the `--evidence` string. Missing receipt → record BLOCKED, not PASS. Added Constraint #13 and a Stop Rule for leftover state.
