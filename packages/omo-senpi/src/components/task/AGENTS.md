# task component

Senpi adapter for the `@oh-my-opencode/senpi-task` engine: task/team tools, the DAG run surface, RPC bridges, and the durable session-lifecycle wiring. The engine's state machine, runners, and DAG scheduler live in `packages/senpi-task`; this directory owns only the composition against the ExtensionAPI.

## Anatomy

| Path | Purpose |
|------|---------|
| `index.ts` | Component factory: member-process early return, unconditional process sweep, `--no-omo-task` flag, capability gate (`surface.ts`), engine + team + DAG composition, tool/command/renderer registration, `wireDagLifecycle` ordering (DAG `pauseForShutdown` binds BEFORE the task lifecycle's `session_shutdown`). |
| `engine.ts` / `engine-runners.ts` / `engine-store-chain.ts` | `composeTaskEngine`: manager, store, lifecycle, notifier, planner, runners (in-process + rpc-process). `TASK_CHILD_UI_ONLY_TOOL_NAMES` excludes the memory tools from children. The store wrapper chain (completion-observing, config-generation stamping, mutation-notifying) is composed in `engine-store-chain.ts`. |
| `planner.ts` | ChildPlanner over the live senpi model registry. Resolution order: known agent name, then explicit model verbatim, then category via omo.json + registry; missing registry fails closed as `model_unavailable`. |
| `event-bridge.ts` | Session-start recovery chain in strict order (flush buffered completions, reconcile, liveness re-observe, reservation reclaim, redelivery, TTL cleanup, lead poll, status sync) plus reason-aware `session_shutdown` suspension and the once-per-session usage hint. |
| `dag-runtime.ts` | DAG composition root: one shared manager/store graph feeding the tool, scheduler, RPC bridge, TUI, wake emitter, and lifecycle adapters. |
| `dag-tool.ts` / `dag-commands.ts` | The `workflow` tool (typebox params, `validateTaskTarget`) and read-only `/dag` slash commands over structural DagManager mirrors. Eight actions: `start`, `attach`, `snapshot`, `wait`, `cancel` (run-scoped) plus `retry`, `send`, `amend` (node-scoped recovery). Params live in `dag-tool-params.ts`, the result/error vocabulary in `dag-tool-contract.ts`, and the three node-scoped action handlers in `dag-tool-control.ts`. |
| engine node ops (`packages/senpi-task/src/dag/`) | `node-retry.ts` gives failed/cancelled/skipped nodes a fresh attempt and un-skips their cascaded dependents; `node-send.ts` steers a running node's child or revives a finished resident one; `node-control-context.ts` is the shared resolution/validation seam both use. Node-scoped errors: `node_not_found`, `node_not_retryable`, `node_not_continuable`, `amend_running_node`, `invalid_amendment`, `run_still_active`. |
| `dag-rpc-bridge.ts` / `dag-rpc-handlers.ts` | Three wire channels: sequenced `omo.dag.event` ledger, unsequenced telemetry, snapshot push; four query handlers sharing one parser vocabulary and error envelope. Contract types in `dag-rpc-bridge-contract.ts`, payloads in `dag-snapshot-payload.ts`. |
| `dag-wake.ts` / `dag-wake-source.ts` | Idle-injection wake messages (`omo-senpi.dag-run`) and read-only `wake_source_state` liveness under source `omo-dag`. |
| `task-rpc-bridge.ts` / `task-rpc-codec.ts` | `omo.task.updated` snapshot push plus task send/cancel/output over RPC; the codec bounds every field (`st_` id pattern, 32k text caps, 1000 tail lines). |
| `team-service.ts` / `team-service-support.ts` | Lead-side team CRUD, mailbox reconcile, shutdown request/approve/reject over `team-core` storage; spec normalization + member validation in the support module. The team lead is ALWAYS the current session (no model-supplied override); run ids are canonical UUID-v4, and foreign owned-team run ids are rejected, never answered with empty data. |
| `lead-poller-lifecycle.ts` | One 1-second lead poller per team led by the current session; delivery journal + idle-injection sink. |
| `member-liveness.ts` / `owned-member-liveness.ts` | Death notifications for owned members (`senpi-task.team-member-liveness`); suspended residency states (`persisted_only`/`rpc_detached`) are skipped, not dead. |
| `skill-invocation-tracker.ts` | Per-session state for the metis/momus plan gate: three trust-separated channels (skill invocation, stripped user request, `.omo/plans/*.md` artifact touches); extension-sourced input never arms it. |
| `completion-bridge.ts` / `parent-notifier.ts` / `session-transition-bridge.ts` | Terminal-status observation on the store, coordinator-batched completion delivery (`senpi-task.completion`), and the ONLY release path for completions buffered during compact/switch/shutdown transitions. |
| `resumption-channel-emitter.ts` | `wake_source_state` snapshots under source `senpi-task` for non-terminal background children and owned members; emits only on count change. |
| `status-ui.ts` / `status-row-format.ts` / `dag-status-ui.ts` | Debounced (250 ms) footer/widget rows for tasks and DAG runs; `store-mutation-observer.ts` triggers the sync without polling. |
| `terminal-observers.ts` / `store-status-edge.ts` | Process-shared terminal-edge ledger (`globalThis` + `Symbol.for("omo.task.terminalObservers")`, so a session re-register never orphans subscribers) plus the before/after status-edge detector `store-mutation-observer.ts` drives. Fires once per nonterminal-to-terminal write across save/replace/mutate/transition, so reconciliation's `lost` writes are seen too; an observer throw never reaches the store. |
| `category-config-generation.ts` / `config-generation-store.ts` | Session-local generations of the effective category map, canonicalized at the planner seam against the LIVE model registry (masking injectable, identity by default). A claimed record is stamped with the generation that planned it, and the stamp is sticky across later writes. |
| `reload-guard.ts` | `/reload` veto while resident children are `running`. |
| `commands.ts` | `/tasks` and `/task-kill` over a narrow list+cancel manager seam. |
| `runtime-context.ts` | `LiveTaskContext`: structural slice of senpi's ExtensionContext (`ui` captured on entry, cleared on switch/shutdown; concrete model registry shared with in-process children). |
| `residency-registry.ts` | Lifecycle's ResidencyRegistry as a view over the manager's live handles; one shared prune path via `manager.forget`. |
| `process-sweep.ts` | Unconditional session-start LSP proxy/daemon hygiene; fires before any flag or capability gate. |

## Key exports

`createTaskComponent` (index.ts), `wireEventBridge` + `TASK_USAGE_HINT_FLAG`, `composeTaskEngine`, `createDagRuntime`, `createDagTool` + `WORKFLOW_TOOL_NAME`, message types `TASK_COMPLETION_MESSAGE_TYPE`, `TEAM_MEMBER_LIVENESS_MESSAGE_TYPE`, `CATEGORY_UNAVAILABLE_MESSAGE_TYPE`, `DAG_WAKE_MESSAGE_TYPE`.

## Lifecycle and wiring

- Register: sweep first, then flag + capability gates, then config load (`loadSenpiOmoConfig` anchored to `pi.cwd`, never `process.cwd()` on cwd-capable hosts), then engine, renderers, tools (4 task + 6 lead team + `workflow`), commands, status UI.
- `engine.onStoreMutation` fans out to status sync, DAG sync, and resumption-channel emission.
- `wireDagLifecycle` order matters: DAG shutdown pause registers before the task lifecycle handlers so runs suspend before children tear down; `session_start` attaches, `session_before_switch` detaches, `session_shutdown` disposes.
- Team member processes see `isTeamMemberProcess()` true and register nothing; the scoped member extension lives in `senpi-task`.

## Conventions

- Every senpi surface is consumed through a locally declared structural slice (`CommandManager`, `DagWakeSourceManager`, `LiveTaskContext`); never import senpi concrete types where a port suffices.
- Optional ExtensionAPI members go through `?.`; missing `pi.events` or RPC is a silent no-op, missing required capabilities is one warning + skip.
- Tool definitions spread into fresh object literals at `registerTool` (typed renderCall vs record seam), no casts.
- RPC inputs are parsed and bounded in `task-rpc-codec.ts` before touching the manager.

## Anti-patterns

- Don't put engine behavior here: state machine, runners, DAG scheduling, and completion invariants belong in `packages/senpi-task`.
- Don't emit unsequenced payloads on the `omo.dag.event` ledger channel; viewer catch-up dedupes on seq.
- Don't let task children inherit memory tools; extend `TASK_CHILD_UI_ONLY_TOOL_NAMES` instead.
- Don't reorder the session-start recovery chain in `event-bridge.ts`; each step's comment documents the invariant the next step relies on.
- Don't treat `persisted_only`/`rpc_detached` members as dead in liveness paths.
