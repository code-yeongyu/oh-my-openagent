# senpi-task - Senpi Task State Machine + Tool Surface

**Generated:** 2026-07-17 / 7d664b96b

## OVERVIEW

The Senpi-coupled engine behind the `omo-senpi` task component: a durable task state machine, a persistent record store, two child runners (in-process and RPC process), a residency/TTL/reconcile lifecycle, an exactly-once completion notifier, a steering engine, a named-team runtime, and the 4 task + 7 lead-team `ToolDefinition`s. Package: `@oh-my-opencode/senpi-task` (private, `sideEffects: false`). `@code-yeongyu/senpi` and `typebox` are optional peers (`package.json:25`) so pure state/store/schema code stays runnable without a live Senpi import; runner and tool code that needs the Senpi surface is isolated. Do not import `packages/omo-opencode` from here.

## ANATOMY

| Area | Path | Purpose |
|------|------|---------|
| State machine | `src/state/` | `TaskStatus` (7: `pending`/`running`/`completed`/`error`/`cancelled`/`interrupted`/`lost`) and `ResidencyState` (5) enums, `TaskRecord`, and `transitionTaskRecord` with late/invalid-transition audits (`state/types.ts`, `state/transitions.ts`). |
| Store | `src/store/` | `createTaskRecordStore` JSONL record store with an in-memory read cache (mtime+size validated; `list()` prunes entries whose files vanished on disk) and a capped (16) LRU append-fd pool reusing open JSONL log handles; `resolveStateDir` (`<project_dir>/.omo/senpi-task` default, `store/state-dir.ts:6`), redaction, and the security test. |
| Runners | `src/runners/` | `InProcessRunner` (shares parent tool closures) and `RpcProcessRunner` (spawns a child Senpi process with JSON-RPC steer/abort/prompt). RPC internals under `src/runners/rpc/`. |
| Manager | `src/manager/` | `createTaskManager` wiring runners, concurrency, name registry, depth policy, execution-mode resolution, and transcript logging. |
| Lifecycle | `src/lifecycle/` | `createTaskLifecycle` - residency admission (`residency.ts`), TTL sweep (`ttl.ts`, skips records with a live resident handle so deletion cannot orphan an in-memory handle), crash reconcile (`reconcile.ts`), and shutdown teardown (`shutdown.ts`). |
| Completion | `src/completion/` | `createCompletionNotifier` + `routeCompletion` - the exactly-once wake/deliver/buffer/queue routing table (`completion/routing.ts`). |
| Steering | `src/steering/` | `createSteeringEngine` - send / interrupt / cancel against a live or resident child. |
| Team | `src/team/` | Named-team registry, normalize/validate, durable pull mailboxes, lead poller, member self-polling extension, tasklist, shutdown handshake, and runtime (`team/runtime.ts`). |
| Tools | `src/tools/` | `task/` (single or `tasks:[...]` batch spawn), `control/` (`task_send`/`task_cancel`), `output/` (`task_output`), `team/` (the 7 lead-only tools, including `team_wait`). |
| Agents | `src/agents/` | `loadAgents` + `mapOmoConfigAgents` - omo.json agent definitions to task-tool targets. |
| Category | `src/category/` | `resolveCategory` + per-provider builtin category tables (anthropic/openai/google/kimi). |
| Adversarial | `src/__adversarial__/` | Seeded 200-iteration chaos bench asserting the four W1 invariants (`chaos-bench.test.ts`). |

## PUBLIC API (`src/index.ts` barrel)

### Task tools (4, names as registered)

| Tool | Factory | File |
|------|---------|------|
| `task` | `createTaskTool` | `tools/task/tool.ts:9` (`TASK_TOOL_NAME`) |
| `task_send` | `createTaskSendTool` | `tools/control/send.ts` |
| `task_cancel` | `createTaskCancelTool` | `tools/control/cancel.ts:61` |
| `task_output` | `createTaskOutputTool` | `tools/output/output.ts` |

`task` is spawn-only. It accepts either one `prompt` or a non-empty `tasks:[...]` batch; synchronous batches aggregate every child result, while background batches return item ids and queue positions. Continue, steer, park, team messaging, and shutdown approval traffic goes through `task_send`; child output and single-child blocking reads go through `task_output`.

### Team tools (7, lead-only)

`buildLeadTeamTools(deps)` returns them in canonical order (`tools/team/index.ts`): `team_create`, `team_delete`, `task_create`, `task_get`, `task_list`, `task_update`, `team_wait`. Child/member sessions never receive the lead family. Each process member loads the bundled member extension in-child and receives only team-scoped `task_send` and `team_wait`; it never receives lead lifecycle or tasklist tools.

`packages/omo-opencode` is a separate build that still uses its prior task/team names; cross-edition parity is a deliberate follow-up outside this package.

### Engine primitives

`createTaskManager`, `createTaskLifecycle`, `createCompletionNotifier` / `routeCompletion` / `shouldNotifyStatus`, `createSteeringEngine`, `InProcessRunner`, `RpcProcessRunner`, `createTaskRecordStore` / `resolveStateDir`, `transitionTaskRecord` / `createTaskRecord`, `resolveCategory`, `loadAgents` / `mapOmoConfigAgents`, plus the team runtime (`createTeam`, `deleteTeam`, `sendTeamMessage`, `createLeadPoller`, `WaitRegistry`, `resolveMemberExtensionEntryPath`, `createTeamTask`, `requestShutdown`/`approveShutdown`/`rejectShutdown`, ...) and their typed errors (`SenpiTeamSpecError`, `SenpiTeamRuntimeError`, `SenpiShutdownError`, `RunnerError`, `TaskRecordCollisionError`).

## TEAM DELIVERY MODEL

Team messaging is pull-only. A send writes a durable unread JSON file and returns; it never injects, steers, revives, or notifies the recipient directly. The current lead owns one `createLeadPoller` per team whose durable `leadSessionId` matches the current session. The adapter ticks owned lead pollers on `session_start` and every second, but suspends ticks during compaction, session switching, and shutdown. Member inboxes are never polled by the adapter: each process member loads `member-extension/`, which owns that member's poller and scoped tools inside the child process.

Delivery is reservation-based: unread `<messageId>.json` becomes `.delivering-<messageId>.json`, then commits to `processed/<messageId>.json` only after the message is observed in the recipient session or a registered `team_wait` claims it. The processed file is the durable exactly-once ledger. A committed wait also appends `team_message_waited`; `task_output` renders it as `[team message from <from>] <body>`, so a caller that lost the immediate tool result can recover the body from the task log.

Persistence of the delivered `peer_message` envelope in the lead's session JSONL is checked by `createSessionMarkerIndex` (`team/messaging/session-marker-index.ts`): a per-path incremental byte-offset index that reads only bytes appended since the last check, so the many `messageId` lookups per tick are O(1) instead of re-reading and re-parsing the whole file. It handles file truncation/rotation by rescanning from zero, and reads nothing when the file has not grown.

Every `session_start` runs recovery in order: reattach durable process members, reclaim stale member and owned-lead reservations, retry failed completion notifications, then poll owned leads. Dead process members with a persisted session are respawned without replaying their original prompt and rebound with `switch_session`; set `task.reattach_on_reconcile: false` only to retain the old lost-task behavior.

### Completion routing table (`completion/routing.ts`)

`shouldNotifyStatus` fires only for externally-caused terminals `completed`/`error`/`lost` (`routing.ts:4`); parent-initiated cancel/interrupt return synchronously in the tool result and never push. `routeCompletion` maps parent state to an action: `idle` -> `wake` and `streaming` -> `deliver_streaming`, both delivered unconditionally (no setting may suppress, delay, or split them - the omo-senpi coordinator batches every notification ready in the same window into ONE injection steered into the running turn at the next tool-call boundary), and `compacting`/`session_switching`/`session_shutdown` -> `buffer` until the parent settles (`routing.ts:12`).

## EXECUTION MODES

- **in-process (default)**: `InProcessRunner` runs the child through the SAME parent tool closures (`filterSharedParentTools` + `mergeChildCustomTools`), so a child sees the parent's live custom tools minus the `task_*`/`team_*` family. Proven by the marker-tool test (`src/runners/in-process/marker-suppression.test.ts`).
- **process**: `RpcProcessRunner` spawns a child Senpi process; steering (`steer`/`abort`/`prompt`) crosses a JSON-RPC boundary (`src/runners/rpc/protocol-client.ts`), child transcripts land under `<stateDir>/children/<taskId>/sessions/<taskId>/`, and session-start reconciliation can respawn and `switch_session` to the newest persisted JSONL. Team members always use this mode so the member extension and durable inbox poller live inside the child.

Mode is chosen by `resolveExecutionMode` from the omo.json `task.default_execution_mode` and per-agent `execution_mode` (`src/manager/execution-mode.ts`).

## QA

```sh
tsgo --noEmit -p packages/senpi-task/tsconfig.json
bun test packages/senpi-task
```

- Co-located `*.test.ts` throughout use given/when/then. The seeded chaos bench (`src/__adversarial__/chaos-bench.test.ts`, 200 iterations, `SEED=<label>` to rerun a seed) asserts: (1) exactly-once notification per `(task_id, run_epoch)`, (2) terminal idempotence, (3) no concurrency slot leak, (4) no unhandled rejection.
- Standalone manual QA scripts write a disposable fixture tree and never touch repo state: `bun packages/senpi-task/scripts/manual-qa.ts <evidence-dir>` (store + transitions), plus `manual-category-qa.ts`, `manual-agents-qa.ts`, `manual-output-qa.ts`.
- Live end-to-end proof runs through the `omo-senpi` task component drivers, not this package alone. `task-e2e.mjs` proves single and `tasks:[...]` batch delegation; `team-e2e.mjs` proves the pull handshake, `team_wait`, reservation reclaim, and kill-between-inject-and-commit restart deduplication. See [`packages/omo-senpi/AGENTS.md`](../omo-senpi/AGENTS.md).

Parent: [`packages/AGENTS.md`](../AGENTS.md).
