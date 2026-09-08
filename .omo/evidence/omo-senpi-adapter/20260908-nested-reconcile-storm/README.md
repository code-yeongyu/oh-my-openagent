# Senpi marked-child reconciliation boundary QA

## What was tested

The real worktree `senpi` binary loaded the generated production plugin from
`packages/omo-senpi/plugin` in isolated sandboxes.

1. Before the production change:

   ```sh
   SENPI_BIN=<worktree>/node_modules/.bin/senpi \
     bun packages/omo-senpi/scripts/qa/task-child-reconcile-e2e.mjs \
     --evidence-dir <this-directory>/red \
     --plugin-path <worktree>/packages/omo-senpi/plugin
   ```

2. After rebuilding the production plugin:

   ```sh
   SENPI_BIN=<worktree>/node_modules/.bin/senpi \
     bun packages/omo-senpi/scripts/qa/task-child-reconcile-e2e.mjs \
     --evidence-dir <this-directory>/green \
     --plugin-path <worktree>/packages/omo-senpi/plugin
   ```

3. Root-session recovery after the change:

   ```sh
   SENPI_BIN=<worktree>/node_modules/.bin/senpi \
     bun packages/omo-senpi/scripts/qa/task-parent-restart-e2e.mjs \
     --evidence-dir <this-directory>/root-green \
     --plugin-path <worktree>/packages/omo-senpi/plugin
   ```

## What was observed

- RED: restored marked child session `01a081ab-ecd4-7e50-b9cf-43c7d9b71297`
  automatically replaced nested task `st_01a081ab` PID `2946015` with
  PID `2946525`, and the driver exited 1.
- GREEN: restored marked child session `01a081b2-e3c8-74a6-9f28-6372b8db037a`
  kept nested task `st_01a081b2` at its dead pre-restart PID `3011916`;
  `recursiveReconcileObserved` and `reconcileEventObserved` were both false.
  The driver exited 0.
- Root GREEN: after root PID `3028527` was hard-killed, replacement root PID
  `3028896` continued the same child task `st_01a081b4`; the driver exited 0.
- The marked-child driver used isolated agent directory
  `/tmp/omo-senpi-qa-AQOpk4/agent` and recorded `realSenpiUntouched: true`
  from before/after tree digests of `/home/thewind/.senpi/agent`.
- RED, marked-child GREEN, and root GREEN each reported `leakedPids: []` and
  `sandboxRemoved: true`. Post-run probes found none of the recorded PIDs and
  no `task-rpc/launcher.mjs` process.

Structured artifacts:

- `red/task-child-reconcile-summary.json`
- `green/task-child-reconcile-summary.json`
- `root-green/parent-restart-summary.json`
- `root-green/parent-restart-transcript.txt`
- `task-send-focused-green.txt`
- `ultrawork-notepad.md`
- `code-review.md`
- `gate-review.md`
- `ultrawork-notepad.md`

The separate focused engine check also passed twice for explicit `task_send`
lazy revival of a terminal `rpc_detached` child: exactly one RPC respawn and
exactly one message delivery.

An extra run of the unchanged broad `task-e2e.mjs` driver reported unrelated
FAIL checks. Its transcript showed stale scripted calls to the removed direct
`bash` tool, and the clean-quit `task_send` assertion conflicts with the current
documented contract that suspended children resume only with their parent
session. Its own isolation checks passed (`real_senpi_untouched`,
`no_leaked_pids`), and all nine emitted sandbox roots were removed afterward.
This extra diagnostic is not counted as a passing gate.

## Why this is enough

The marked-child driver seeds a real persisted process-mode child, kills its
marked parent, and resumes the same parent session. The only behavior changed
between RED and GREEN is the production session-start boundary. The separate
root restart driver proves the marker-specific guard does not disable normal
root recovery. The focused detached-RPC tests prove the explicit lazy
`task_send` path remains intact without conflating it with clean-quit
suspension.

## What was omitted

Raw environment dumps and credentials were not captured. The root transcript
is retained because it uses the local mock provider and contains no secrets.
