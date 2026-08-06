# AgentControl handoff v1 evidence

## What was tested

- `python -m pytest tests/agent_control`: parser, rejection, propagation, ledger migration, restart persistence, and Dispatch monitor rendering.
- Focused Bun tests for the AgentControl public tools and worker prompt composition.
- `bun run typecheck` and `bun run build` from the worktree.
- Three real `opencode run --auto --format json` sessions using the worktree `dist/index.js`, an isolated XDG sandbox, and a deterministic local Responses API provider:
  - missing handoff rejection;
  - valid `Explore` launch and direct `Report`;
  - valid `Dispatch` launch, final report, and group completion.
- Dispatch dashboard rendering from the real QA ledger, including the `H` handoff view.
- 5,000-iteration valid and rejected handoff validation benchmarks.

## What was observed

- Python: 132 passed.
- Focused TypeScript: 41 passed.
- Typecheck and build completed successfully.
- `invalid-run.jsonl` records `HANDOFF_NOT_FOUND` with `status: REJECTED` before worker creation.
- `explore-run.jsonl` and `dispatch-run.jsonl` contain absolute handoff paths, IDs, and SHA-256 digests returned by real tool calls.
- `ledger.json` shows the same trusted metadata persisted for both workers.
- The direct worker emitted `[AGENT_REPORT qa-explore kind=explore]`; Dispatch emitted `[AGENT_GROUP_DONE qa-handoff]` after its final report.
- `qa-summary.txt` proves the host OpenCode session count stayed at 1276 before and after all three runs.
- `dashboard.txt` shows `handoff qa-dispatch-v1 · VERIFIED` in the inspector. `dashboard-handoff.txt` shows the ID, digest, project-local path, and full document body.
- The monitor refuses to display substituted handoff content when its current digest differs from the launch-time digest.

## Performance

`benchmark.txt` records a 0.0603 ms median and 0.1057 ms p95 for reading, parsing, validating, and hashing a valid handoff. Missing-path rejection had a 0.0191 ms median. The real OpenCode tool durations were 91 ms for rejection, 4,686 ms for interactive Explore startup, and 276 ms for Dispatch startup. Handoff validation is therefore negligible compared with process and TUI startup.

The monitor caches each shared `(path, digest)` once per refresh, so a Dispatch group sharing one handoff performs one read and hash per refresh rather than one per worker.

## Remaining limitation

The repository-wide `bun test` could not complete under the installed Bun `1.3.13-canary.1`: after the change-related failure was corrected and its focused test passed, the full process still ended with Bun signal 139. `bun-test-failure.txt` records the runtime failure. No test failure preceded that crash. CI pins Bun 1.3.12; the scoped suites, typecheck, build, and real OpenCode QA all passed.

## Artifact map

- `invalid-run.jsonl`, `explore-run.jsonl`, `dispatch-run.jsonl`: structured real OpenCode events.
- `qa-summary.txt`: exit codes and host database isolation proof.
- `ledger.json`: persisted trusted metadata.
- `dashboard.txt`, `dashboard-handoff.txt`: dashboard and handoff viewer output.
- `benchmark.txt`: validation timings and observed real tool durations.
- `fake-openai.mjs`: deterministic local provider used by the isolated run.
- `explore-handoff.md`, `dispatch-handoff.md`: validated QA handoff documents.
- `bun-test-failure.txt`: full-suite Bun runtime crash summary.
