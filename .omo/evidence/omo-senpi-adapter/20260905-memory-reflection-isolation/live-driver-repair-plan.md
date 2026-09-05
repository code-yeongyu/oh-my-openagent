# Live driver repair

- [x] Read package/QA instructions and trace settings discovery, parent invocation, plugin registration, and detached child arguments.
- [x] Add the worktree-relative built omo.js entry to the shared parent invocation in memory-model-fallback-e2e.mjs; change no production code.
- [x] Attempt driver diagnostics (unavailable: language server cannot find TypeScript); syntax validation and isolation harness self-test pass.
- [x] Execute the real driver with worktree-local Senpi, retained sandbox, and system-prompt capture. A distinct stale-context blocker prevents child launch/completion; child argv and child system prompt checks cannot run. No ModelUsabilityBudgetError observed in captured stderr/session evidence.
- [x] Record exact JSON and retained sandbox paths in live-driver-result.json. Lead owns package-wide production gates, retained-sandbox cleanup, and real-home digest comparison.

The existing red-live-driver.txt is the faithful RED. No source-text test is added.
