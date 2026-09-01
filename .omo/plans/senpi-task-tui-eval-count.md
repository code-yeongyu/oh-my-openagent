# Senpi task TUI eval accounting

## Outcome

Ship one atomic PR that changes the running Senpi task TUI so it:

1. omits cache-hit-rate text while retaining cost and throughput;
2. counts the outer `eval` call plus every nested invocation reported by the eval result;
3. preserves ordinary non-eval tool counting and completed-run statistics.

## Constraints

- Work only in the task-owned worktree `fix/senpi-task-tui-eval-count`.
- Keep the dirty/conflicted main checkout untouched.
- Use TDD with captured RED before production edits.
- Do not invoke Momus.
- Keep the change local to the existing run-stats and running-row seams.
- Use a merge commit into `dev`.

## Evidence-backed findings

- `packages/senpi-task/src/run-stats.ts:createRunStatsTracker` increments once for each top-level `tool_execution_start`.
- A Senpi session transcript records an eval as one top-level tool call. Nested eval operations are present only inside the eval tool result details, so the current tracker cannot see them.
- The eval result may carry top-level `details.toolCalls` plus `details.statusEvents`; the latter is also repeated per cell, so only one canonical level may be counted.
- `packages/omo-senpi/src/components/task/status-row-format.ts:liveStatsTokens` renders `formatLiveSpend`, which currently combines cost and latest cache-hit rate.
- `packages/omo-senpi/scripts/qa/task-stats-renderer.mjs background` is the deterministic real-terminal fixture.

## Execution

### Cache display

1. Add a failing running-row test expecting cost without `CH:`.
2. Capture focused RED.
3. Change only the running status spend formatter to emit cost without cache-hit rate.
4. Capture focused GREEN.

### Eval accounting

1. Add failing tests for:
   - eval start plus an eval result reporting two nested invocations equals three;
   - eval with no nested invocations remains one;
   - a normal tool remains one;
   - duplicated cell-level status events are not double-counted.
2. Capture focused RED.
3. Extend the widened managed child event/result parsing at the run-stats boundary.
4. Count nested eval invocations on the eval end event without recounting the already-counted outer start.
5. Capture focused GREEN.

### Real surface

1. Update the deterministic renderer fixture to include cost and use `tool_calls: 3`.
2. Run:

   ```sh
   node script/qa/web-terminal-visual-qa.mjs \
     --title "Senpi task running status row" \
     --command "bun packages/omo-senpi/scripts/qa/task-stats-renderer.mjs background" \
     --source-label "task-stats-renderer background scenario" \
     --cwd "$PWD" --cols 160 --rows 12 --dwell-ms 2500 \
     --evidence-dir .omo/evidence/20260803-senpi-task-tui-stats/terminal
   ```

3. Pass only if the xterm transcript and screenshot show `turn 3 (3 tools)`, `$0.1303`, `42 tok/s`, no `CH:`, and one physical running row.

## Verification

- Changed-file LSP diagnostics.
- Focused status and run-stats tests.
- `bun test packages/senpi-task`.
- `bun test packages/omo-senpi/src/components/task`.
- `tsgo --noEmit -p packages/senpi-task/tsconfig.json`.
- `bun run test:senpi`.
- `bun run typecheck`.
- `bun run build`.
- Final PR CI and Cubic gates.

## Delivery

Create atomic verified commits, push, open an English PR into `dev`, arm merge-commit auto-merge, wait for actual merge, then remove the task worktree and branch.
