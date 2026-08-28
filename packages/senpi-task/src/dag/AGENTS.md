# dag - Dependency-Frontier Task DAG Engine

Compile a node definition into an execution graph, admit each node the moment every node it dependsOn has completed (plus a free resident slot), journal every boundary transition to a filesystem WAL, and recover runs after crashes. Largest subsystem in senpi-task (35 files, ~13.9k LOC; added after the 2026-07 package snapshot). Public surface: `index.ts` barrel + package subpath `./dag`; consumer is the omo-senpi task component (`dag-runtime.ts`, `dag-tool.ts`, `dag-rpc-bridge.ts`).

## Anatomy

| Path | Purpose |
|------|---------|
| `types.ts` | Domain vocabulary: branded `DagRunId`/`DagNodeId`, 6 run statuses, 8 node states, route union (category XOR agent, no model-only route), `DAG_RUN_EVENT_TYPES` (17 boundary types), settings defaults (`max_runs_per_session: 16`, `retention_days: 7`), flat event envelope, unsequenced activity types. |
| `graph.ts` | `compileDag`: deterministic ordering, invalid-dep/cycle detection, wave groupings (informational metadata for event grouping + rendering), critical path, bottlenecks. |
| `fingerprint.ts` | `dagFingerprint` (canonicalize -> sha256), `dagDefinitionFingerprint`, `nodeFingerprintInput`. |
| `events.ts` | Pure builders for all 17 boundary events. No seq/lane metadata here. |
| `journal.ts` | `createDagJournal` / `subscribeDagJournal`: sequenced append + checkpoint projection seam. |
| `store.ts` | `createDagFileStore`: WAL append/read with torn-tail recovery, checkpoint/result/key persistence, run/key/task-owner locks, per-session run cap, retention pruning. Layout `<stateDir>/dag/{runs,events,results,keys,locks}`; key ids `dagKeyHash = sha256(parentSessionId + "\0" + runKey)`. Atomic temp+rename writes, fsync on by default. |
| `manager.ts` | `createDagManager`: start/amend/replay, `DagRunRecordV1` projection, fingerprint-keyed run reuse; amendment guards `invalid_amendment`, `amend_running_node`, `run_still_active`. |
| `scheduler.ts` | `createDagScheduler`, `applyDagSchedulerEvent`, `observeDagSchedulers`: dependency-frontier execution (node admitted when every dependsOn node completed + a free slot), residency-denied retry queue, task attach/outcome folding, dependent skip cascade (runs at frontier quiescence), cancellation, event replay. |
| `node-control-context.ts` + `node-retry.ts` + `node-send.ts` | Node-scoped recovery: retry failed/cancelled/skipped nodes (un-skips cascaded dependents), steer a running node's child or revive a finished one. Codes `node_not_found` / `node_not_retryable` / `node_not_continuable`. |
| `recovery.ts` | `createDagRecovery`: durable-owner reconciliation, journal replay, result reuse, scheduler re-entry, lost-task handling. Reconciliation NEVER awaits a still-running reattached child; it hands the child to the scheduler through `preAttachedTasks`. |
| `results.ts` | `persistDagNodeResult` / `readDagNodeResult`: terminal node final response + run_stats sidecar into the result store; paths relative to the state dir. |
| `handle.ts` | `createDagWaitSurface`: resolves terminal `DagRunResult`s. |
| `owner.ts` | `DagTaskOwner` identity (runId + nodeId + fingerprint over definition/node/execAttempt) for task-owner locks and ownership checks. |
| `execution-mode.ts` | Per-node execution-mode resolution. |
| `skills.ts` | `createDagSkillMaterializer` / `readDagSkillManifest`: creation-time effective-prompt snapshot. |
| `scheduler-frontier` `.test.ts` | Regression matrix for frontier admission (dag_530ad299): dependent admitted behind an unrelated running sibling, dependency gate preserved, residency FIFO, informational wave grouping. |
| `e2e-happy` / `e2e-failure` / `scheduler-spill` `.test.ts` | Integrated runner-path coverage (happy path, failure/recovery, spill). |

## Admission semantics

- A node starts once EVERY node it dependsOn holds `completed` and a resident slot is free (dependency-frontier admission). Compiled waves NEVER gate execution; `dag.wave.started` groups the nodes one admission pass scheduled (one wave index can appear in several started events when its nodes become ready at different times) and `dag.wave.completed` fires once per index when the wave's FULL membership is terminal (skipped and failed nodes included in the listing).
- The dependent skip cascade runs at frontier quiescence (nothing attached): a failed node stays revivable via `send` while siblings are mid-flight, so an eager cascade would strand revived-completable dependents as skipped.

## Conventions

- Policy is fixed inside the definition fingerprint: `dependency-frontier` wave admission (was `strict-barrier` before 2026-08-25), `continue-independent` failure handling, filesystem-only dependency data.
- Run reuse keys on the SUBMITTED definition (canonicalized). Amendments preserve eligible node state and invalidate affected dependents.
- Boundary events are sequenced by the journal writer; live telemetry rides the unsequenced `omo.dag.activity` channel as a separate union.
- Node target rules mirror the task tool: category XOR `subagent_type`, model only with an agent route, error codes `both_targets` / `no_target` / `category_with_model`.

## Anti-patterns

- NEVER fold skill content, skill digests, or effective prompts into definition fingerprints; reuse must survive skill materialization changes.
- NEVER key recovery by display attempt; read the persisted `execAttempt` (reattach bumps the display attempt).
- NEVER resume a prior scheduler instance; cancellation deferreds and admission latches are single-shot. Use re-entry / retry / send controls. A re-entry drops `preAttachedTasks`: those ids describe children that were live for the PREVIOUS instance, and re-attaching a settled task folds its outcome onto the node twice.
- NEVER block recovery's reconcile loop on a live child. A restart must emit reuse events and `dag.run.resumed` immediately and let the still-running child fold through the normal settle loop, or the run sits in `paused` for as long as the slowest child runs and every operator lever (amend, retry) refuses on `run_still_active`.
- NEVER put activity events or journal seq/lane metadata into boundary builders.
- Missing skills never fail a run; they become `missing_skill` diagnostics. Resumed runs read creation-time materialization, never current `SKILL.md`.
- Wait surfaces resolve (not reject) failed/cancelled runs; callers inspect `DagRunResult`.

## QA

```sh
bun test packages/senpi-task/src/dag
bun test packages/senpi-task/src/dag/scheduler.test.ts   # focused
```

`scheduler-spill.test.ts` sets its own `setDefaultTimeout` floor (20s, 60s on Windows): Bun honours a preload's `setDefaultTimeout` only for the FIRST test file of a run.

Parent: [`../../AGENTS.md`](../../AGENTS.md).
