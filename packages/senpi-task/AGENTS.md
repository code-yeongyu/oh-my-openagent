# senpi-task - Senpi Task State Machine + Tool Surface

**Generated:** 2026-07-07

## OVERVIEW

The Senpi-coupled engine behind the `omo-senpi` task component: a durable task state machine, a persistent record store, two child runners (in-process and RPC process), a residency/TTL/reconcile lifecycle, an exactly-once completion notifier, a steering engine, a named-team runtime, and the 7 task + 12 team `ToolDefinition`s. Package: `@oh-my-opencode/senpi-task` (private, `sideEffects: false`). `@code-yeongyu/senpi` and `typebox` are optional peers (`package.json:25`) so pure state/store/schema code stays runnable without a live Senpi import; runner and tool code that needs the Senpi surface is isolated. Do not import `packages/omo-opencode` from here.

## ANATOMY

| Area | Path | Purpose |
|------|------|---------|
| State machine | `src/state/` | `TaskStatus` (7: `pending`/`running`/`completed`/`error`/`cancelled`/`interrupted`/`lost`) and `ResidencyState` (5) enums, `TaskRecord`, and `transitionTaskRecord` with late/invalid-transition audits (`state/types.ts`, `state/transitions.ts`). |
| Store | `src/store/` | `createTaskRecordStore` JSONL record store, `resolveStateDir` (`<project_dir>/.omo/senpi-task` default, `store/state-dir.ts:6`), redaction, and the security test. |
| Runners | `src/runners/` | `InProcessRunner` (shares parent tool closures) and `RpcProcessRunner` (spawns a child Senpi process with JSON-RPC steer/abort/prompt). RPC internals under `src/runners/rpc/`. |
| Manager | `src/manager/` | `createTaskManager` wiring runners, concurrency, name registry, depth policy, execution-mode resolution, and transcript logging. |
| Lifecycle | `src/lifecycle/` | `createTaskLifecycle` - residency admission (`residency.ts`), TTL sweep (`ttl.ts`), crash reconcile (`reconcile.ts`), and shutdown teardown (`shutdown.ts`). |
| Completion | `src/completion/` | `createCompletionNotifier` + `routeCompletion` - the exactly-once wake/deliver/buffer/queue routing table (`completion/routing.ts`). |
| Steering | `src/steering/` | `createSteeringEngine` - send / interrupt / cancel against a live or resident child. |
| Team | `src/team/` | Named-team registry, normalize/validate, mailbox messaging, tasklist, shutdown handshake, and runtime (`team/runtime.ts`). |
| Tools | `src/tools/` | `task/` (spawn), `control/` (`task_send`/`task_wait`/`task_interrupt`/`task_cancel`), `output/` (`task_list`/`task_output`), `team/` (the 12 lead-only tools). |
| Agents | `src/agents/` | `loadAgents` + `mapOmoConfigAgents` - omo.json agent definitions to task-tool targets. |
| Category | `src/category/` | `resolveCategory` + per-provider builtin category tables (anthropic/openai/google/kimi). |
| Adversarial | `src/__adversarial__/` | Seeded 200-iteration chaos bench asserting the four W1 invariants (`chaos-bench.test.ts`). |

## PUBLIC API (`src/index.ts` barrel)

### Task tools (7, names as registered)

| Tool | Factory | File |
|------|---------|------|
| `task` | `createTaskTool` | `tools/task/tool.ts:9` (`TASK_TOOL_NAME`) |
| `task_send` | `createTaskSendTool` | `tools/control/send.ts:118` |
| `task_wait` | `createTaskWaitTool` | `tools/control/wait.ts:173` |
| `task_interrupt` | `createTaskInterruptTool` | `tools/control/interrupt.ts:57` |
| `task_cancel` | `createTaskCancelTool` | `tools/control/cancel.ts:61` |
| `task_list` | `createTaskListTool` | `tools/output/list.ts:61` |
| `task_output` | `createTaskOutputTool` | `tools/output/output.ts:117` |

### Team tools (12, lead-only)

`buildLeadTeamTools(deps)` returns them in canonical order (`tools/team/index.ts:92`): `team_create`, `team_delete`, `team_send_message`, `team_status`, `team_list`, `team_task_create`, `team_task_list`, `team_task_update`, `team_task_get`, `team_shutdown_request`, `team_approve_shutdown`, `team_reject_shutdown`. Child/member sessions never receive the `team_*` family; only a pre-scoped member `team_send_message` is re-added.

### Engine primitives

`createTaskManager`, `createTaskLifecycle`, `createCompletionNotifier` / `routeCompletion` / `shouldNotifyStatus`, `createSteeringEngine`, `InProcessRunner`, `RpcProcessRunner`, `createTaskRecordStore` / `resolveStateDir`, `transitionTaskRecord` / `createTaskRecord`, `resolveCategory`, `loadAgents` / `mapOmoConfigAgents`, plus the team runtime (`createTeam`, `deleteTeam`, `sendTeamMessage`, `createTeamTask`, `requestShutdown`/`approveShutdown`/`rejectShutdown`, ...) and their typed errors (`SenpiTeamSpecError`, `SenpiTeamRuntimeError`, `SenpiShutdownError`, `RunnerError`, `TaskRecordCollisionError`).

### Completion routing table (`completion/routing.ts`)

`shouldNotifyStatus` fires only for externally-caused terminals `completed`/`error`/`lost` (`routing.ts:4`); parent-initiated cancel/interrupt return synchronously in the tool result and never push. `routeCompletion` maps parent state to an action: `idle` -> `wake` (or `queue_silently` when `wake_idle_parent` is false), `streaming` -> `deliver_streaming` using `deliver_as` (`followUp` | `steer`), and `compacting`/`session_switching`/`session_shutdown` -> `buffer` until the parent settles (`routing.ts:12`).

## EXECUTION MODES

- **in-process (default)**: `InProcessRunner` runs the child through the SAME parent tool closures (`filterSharedParentTools` + `mergeChildCustomTools`), so a child sees the parent's live custom tools minus the `task_*`/`team_*` family. Proven by the marker-tool test (`src/runners/in-process/marker-suppression.test.ts`).
- **process**: `RpcProcessRunner` spawns a child Senpi process; steering (`steer`/`abort`/`prompt`) crosses a JSON-RPC boundary (`src/runners/rpc/protocol-client.ts`), child transcripts land under `<stateDir>/sessions/`, and pid kill / lost-child reconciliation is handled by the lifecycle reconcile path (`src/lifecycle/reconcile.ts`).

Mode is chosen by `resolveExecutionMode` from the omo.json `task.default_execution_mode` and per-agent `execution_mode` (`src/manager/execution-mode.ts`).

## QA

```sh
tsgo --noEmit -p packages/senpi-task/tsconfig.json
bun test packages/senpi-task
```

- Co-located `*.test.ts` throughout use given/when/then. The seeded chaos bench (`src/__adversarial__/chaos-bench.test.ts`, 200 iterations, `SEED=<label>` to rerun a seed) asserts: (1) exactly-once notification per `(task_id, run_epoch)`, (2) terminal idempotence, (3) no concurrency slot leak, (4) no unhandled rejection.
- Standalone manual QA scripts write a disposable fixture tree and never touch repo state: `bun packages/senpi-task/scripts/manual-qa.ts <evidence-dir>` (store + transitions), plus `manual-category-qa.ts`, `manual-agents-qa.ts`, `manual-output-qa.ts`.
- Live end-to-end proof runs through the `omo-senpi` task component drivers, not this package alone. See [`packages/omo-senpi/AGENTS.md`](../omo-senpi/AGENTS.md).

Parent: [`packages/AGENTS.md`](../AGENTS.md).
