# WHAT WAS OMITTED

- Live end-to-end QA driving a real OpenCode session (Prometheus -> explore via
  `opencode run` / SSE probe) was NOT performed: this environment is
  network-restricted and cannot spawn a real model-backed child session. The
  dispatched-prompt seam is instead proven directly by tests that capture the
  exact payload passed to `BackgroundManager.launch()`, which is the persisted
  child input the issue reporter inspected manually.
- The upstream OpenCode `tool.execute.before` arg-propagation behavior was not
  patched here (that is OpenCode's code, not this repo); the fix removes OMO's
  dependence on it.
- No secrets, tokens, or env dumps are contained in this evidence; test logs
  contain only synthetic prompts ("Find auth patterns") and mock session ids.
- `bun run build` artifact bundles were intentionally not committed (tracked
  plugin/extensions bundles must never be staged from a worktree gate).
