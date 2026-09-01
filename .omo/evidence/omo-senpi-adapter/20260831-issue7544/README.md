# Issue #7544 Senpi RPC-child startup boundary

## What was tested

- RED mutation proof on Bunshin `gorky`: the pre-fix worktree was transferred
  to `/tmp/ulw-7544-red` and
  `bun test packages/omo-senpi/src/components/task/event-bridge-session-lifecycle.test.ts --test-name-pattern "RPC child marker"`
  failed with `Expected length: 0 / Received length: 1`.
- GREEN focused proof on Bunshin `gorky` and `mengmotaHost`:
  `bun test packages/omo-senpi/src/components/task/event-bridge-session-lifecycle.test.ts packages/omo-senpi/src/components/task/process-sweep.test.ts packages/senpi-task/src/runners/rpc/spawn-marker.test.ts packages/omo-senpi/src/components/task/index.test.ts`
  and `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json` both exited 0.
- Full Bun-only package gate on Bunshin `gorky`:
  `bun install --frozen-lockfile` followed by `bun run test:senpi` exited 0.
- Real Senpi adapter surface on Bunshin `mengmotaHost`:
  `SENPI_BIN=/Users/yeongyu/.bun/bin/senpi bun packages/omo-senpi/scripts/qa/drive.mjs`
  returned `result: PASS`.

## What was observed

- Root sessions without `OMO_SENPI_TASK_RPC_CHILD=1` retained the existing
  session-start recovery ordering and reconciliation.
- RPC spawn descriptors force `OMO_SENPI_TASK_RPC_CHILD=1` after member
  environment overrides.
- The dedicated marker skips parent task recovery, while a
  `SENPI_CODING_AGENT_SESSION_DIR` parent override alone still reconciles.
- A marked child with a captured session id continues the recovery chain and
  still reconciles its own tasks and pending notifications.
- The live adapter driver reported `realSenpiUntouched: true`, empty attributed
  real-home changes, and no task-owned leaks.
- Each remote work directory returned its cleanup sentinel after removal.

## Why this is enough

The regression test exercises the adapter `session_start` seam from issue #7544,
the spawn test proves the marker boundary cannot be overridden, adjacent
lifecycle and process-sweep tests preserve neighboring behavior, and the full
package gate plus live adapter driver cover generated artifacts and the real
Senpi extension surface.

## What was omitted

The aggregate `task-rpc-e2e.mjs` driver was run in an isolated sandbox but
terminated with `SIGTERM` before its first task record was persisted. It was not
used as passing evidence. Raw environment, credential, and process logs were
not copied here; the live driver reported protected real-home state unchanged.

The captured nested-session regression is recorded in `nested-rpc-green.txt`.
