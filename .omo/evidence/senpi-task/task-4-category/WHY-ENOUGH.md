# Why This Is Enough

- The focused category suite covers every required Todo 4 behavior: overlay precedence and prompt append merge, disabled result, delegate-core fallback promotion, unavailable model detail, param carry-through, builtin snapshot, and no local resolver-order implementation.
- The manual QA driver exercises the exported resolver through a real Bun CLI/data surface rather than only via test internals.
- The package-wide test gate proves the new category module is compatible with existing senpi-task state/store/tripwire behavior.
- Full repo typecheck proves the exports and new TypeScript types compile across workspace package boundaries.
- Static guards cover the two key coupling risks: no runtime OpenCode import and no local reimplementation of delegate-core’s model-order prose/logic.
- Snapshot evidence pins the full ported builtin prompt/config payloads for all 8 builtins against future drift.
- Recovery-final artifacts re-ran every required command after the prior executor was closed, with paired logs and `.exit` files, so the DoneClaim does not rely on stale staged output.

Adversarial class coverage:

- malformed_input: disabled, unknown/not-found path in resolver implementation, and unavailable selected model are covered by tests/manual QA.
- stale_state: builtin snapshot and source provenance comments pin the checked-out OpenCode refs; delegate-core import/call guard pins the model-order path.
- dirty_worktree: pre/post status artifacts and cleanup receipt capture generated install byproducts and final scoped changes.
- misleading_success_output: every recovery-final command log has a paired `.exit` file with the exit status; older nonzero red/repair `.exit` files are explicitly classified in `WHAT-OBSERVED.md`.
- flaky_tests: focused category suite was rerun after implementation and after the failing variant-precedence repair.
- prompt_injection: not applicable; category prompts are local builtin/config strings, and the resolver does not execute external text.
- cancel_resume: not applicable; this is a pure resolver with no task lifecycle or child process state.
- hung_or_long_commands: no long-lived resources were started; install/build and all verification commands exited.
- repeated_interruptions: not applicable; no interruption/resume protocol participates in this resolver.
