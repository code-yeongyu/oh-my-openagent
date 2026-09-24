# WHY IT IS ENOUGH

- The failing-first regression tests assert on the exact seam the issue
  identifies as ground truth: the prompt payload handed to the child launcher
  (`BackgroundManager.launch()`), not the hook output object. Red phase
  reproduced the reported divergence (child receives original prompt); green
  phase proves the dispatched prompt now contains
  `<planning-context source="prometheus-read-only">`.
- delegate-task injection sits after `resolveParentContext()` and before ALL
  executor routing, so background, sync, continuation (`task_id`), and
  unstable-agent paths all inherit it (they all read `args.prompt`).
- call-omo-agent injection sits before both executors with the same guard.
- Idempotence is pinned by tests (marker present -> unchanged), so keeping the
  hook-level branch as defense-in-depth cannot cause double injection.
- `disabled_hooks` parity is pinned by tests for both tools, so users who
  disabled the hook keep identical behavior.
- Scoped suites around both touched tool dirs and the hook dir are fully green
  (604 tests) and the repo typecheck gate (tsgo root + script + packages)
  passes.

## Remaining regression risk

OpenCode's own arg-propagation semantics may vary across versions; this fix no
longer depends on them because injection happens inside OMO's dispatch path.
The hook-level log can still claim an injection that OpenCode drops; the
authoritative guarantee now lives at dispatch time. A live end-to-end run of a
real Prometheus session was not driven in this environment (see OMITTED).
