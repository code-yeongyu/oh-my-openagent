# dag - Dependency-Frontier Task DAG Engine

Compile a node definition into an execution graph, admit each node the moment every node it dependsOn has completed (plus a free resident slot), journal every boundary transition to a filesystem WAL, and recover runs after crashes. Largest subsystem in senpi-task (35 files, ~13.9k LOC; added after the 2026-07 package snapshot). Public surface: `index.ts` barrel + package subpath `./dag`; consumer is the omo-senpi task component (`dag-runtime.ts`, `dag-tool.ts`, `dag-rpc-bridge.ts`).

## Anatomy

| Path | Purpose |
|------|---------|
| `types.ts` | Domain vocabulary: branded `DagRunId`/`DagNodeId`, 6 run statuses, 9 node states (`paused` holds a user-stopped node's child), route union (category XOR agent, no model-only route), `DAG_RUN_EVENT_TYPES` (26 boundary types: the 17 lifecycle events plus the 9 paused-run controls in `paused-events.ts`), settings defaults (`max_runs_per_session: 16`, `retention_days: 7`), flat event envelope, unsequenced activity types. |
| `graph.ts` | `compileDag`: deterministic ordering, invalid-dep/cycle detection, wave groupings (informational metadata for event grouping + rendering), critical path, bottlenecks. |
| `fingerprint.ts` | `dagFingerprint` (canonicalize -> sha256), `dagDefinitionFingerprint`, `nodeFingerprintInput`. |
| `events.ts` | Pure builders for the 17 lifecycle boundary events. No seq/lane metadata here. |
| `paused-events.ts` | The 9 paused-run control events (`dag.guidance.*`, `dag.node.cancel_requested`, `dag.node.retry-staged`, `dag.node.pause-recovered`, `dag.node.pause-lost`) and their projection onto the run record. |
| `journal.ts` | `createDagJournal` / `subscribeDagJournal`: sequenced append + checkpoint projection seam. |
| `store.ts` | `createDagFileStore`: WAL append/read with torn-tail recovery, checkpoint/result/key persistence, run/key/task-owner locks, per-session cap on active (non-terminal) runs, retention pruning. Layout `<stateDir>/dag/{runs,events,results,keys,locks}`; key ids `dagKeyHash = sha256(parentSessionId + "\0" + runKey)`. Atomic temp+rename writes, fsync on by default. |
| `manager.ts` | `createDagManager`: start/amend/replay, `DagRunRecordV1` projection, fingerprint-keyed run reuse; amendment guards `invalid_amendment`, `amend_running_node`, `run_still_active`. |
| `scheduler.ts` | `createDagScheduler`, `applyDagSchedulerEvent`, `observeDagSchedulers`: dependency-frontier execution (node admitted when every dependsOn node completed + a free slot), residency-denied retry queue, task attach/outcome folding, dependent skip cascade (runs at frontier quiescence), cancellation, event replay. |
| `node-control-context.ts` + `node-retry.ts` + `node-send.ts` | Node-scoped recovery: retry failed/cancelled/skipped nodes (un-skips cascaded dependents), steer a running node's child or revive a finished one. Codes `node_not_found` / `node_not_retryable` / `node_not_continuable`. |
| `recovery.ts` | `createDagRecovery`: durable-owner reconciliation, journal replay, result reuse, scheduler re-entry, lost-task handling. `installPausedRuns` claims and installs like `resumePausedRuns` but resolves once each claimed run's scheduler is installed (`dag.run.resumed` journaled), handing every `InstalledDagRun` to the caller's `adopt`; `resumePausedRuns` still awaits each run's `settled`. Reconciliation NEVER awaits a still-running reattached child; it hands the child to the scheduler through `preAttachedTasks`. A `live_lease` skip reports the `holderPid` it saw alive so the caller can retry once that host is gone. A holder pid equal to the host's own pid is judged by the injected `isRunHeldInProcess(runId)` (default: not held), never by signal-0, so a same-process session reopen claims the run while a same-runtime pause + re-attach still skips it. |
| `recovery-lease-watch.ts` | `createDagLeaseWatch`: polls a paused run's still-alive previous holder pid (signal-0, unref'd timers, injectable) and fires once when it exits; the adapter re-runs recovery on that signal. |
| `results.ts` | `persistDagNodeResult` / `readDagNodeResult`: terminal node final response + run_stats sidecar into the result store; paths relative to the state dir. |
| `handle.ts` | `createDagWaitSurface`: resolves terminal `DagRunResult`s. |
| `owner.ts` | `DagTaskOwner` identity (runId + nodeId + fingerprint over definition/node/execAttempt) for task-owner locks and ownership checks. |
| `execution-mode.ts` | Per-node execution-mode resolution. |
| `skills.ts` | `createDagSkillMaterializer` / `readDagSkillManifest`: creation-time effective-prompt snapshot. |
| `scheduler-frontier` `.test.ts` | Regression matrix for frontier admission (dag_530ad299): dependent admitted behind an unrelated running sibling, dependency gate preserved, residency FIFO, informational wave grouping. |
| `e2e-happy` / `e2e-failure` / `scheduler-spill` `.test.ts` | Integrated runner-path coverage (happy path, failure/recovery, spill). |

## Admission semantics

- A node starts once EVERY node it dependsOn holds `completed` and a resident slot is free (dependency-frontier admission). Compiled waves NEVER gate execution; `dag.wave.started` groups the nodes one admission pass scheduled (one wave index can appear in several started events when its nodes become ready at different times) and `dag.wave.completed` fires once per index when the wave's FULL membership is terminal (skipped and failed nodes included in the listing).
- The dependent skip cascade runs at frontier quiescence (nothing attached): a failed node stays revivable via `send` while siblings are mid-flight, so an eager cascade would strand revived-completable dependents as skipped. A pass whose every admission failed at start (nothing attached, dependents still pending) re-enters the loop so the cascade settles the run instead of throwing (#8396).
- The resident-child cap is SESSION-wide (`lifecycle/residency.ts` counts every resident record of the parent session), so a residency denial parks the node (`scheduled`, journaled once as `residency_queued` with `residents` / `heldByOtherOwners`) and the scheduler waits on `Promise.race([own settlements, taskManager.residencyChanged(parentSessionId), foreign journal commit, cancellation])` - never on its own `attachedTasks` alone, which is empty for a run that arrives second (#8396). Only a denial naming NO resident (`cause: "residents"`, empty list) terminal-fails the node; a `cause: "lease"` denial re-probes at once because lease acquisition is itself a bounded wait.

## Recovery launch boundary

Recovery resolves the newest owned task of the node's CURRENT `execAttempt` (`recovery-attempt.ts`, classified by `owned-attempt.ts`, the rule the re-entry sweep and admission share) before consulting the checkpoint's `taskId`: `dag.node.retried` retains the prior ID until the replacement's admission batch attaches it. That prior record must not override the replacement's launch evidence or terminal outcome, and a task of an earlier attempt is never folded or re-attached: a live one is stopped before the node starts afresh, and the node fails closed with `stale_attempt_alive` when it cannot be stopped (#11381). A recovery retry event names the selected task in `priorTaskId`, not the checkpoint's retained ID.

`TaskRecord.started_at` is durable before normal start or lifecycle respawn invokes a runner. Respawn preserves an existing stamp without changing status or epoch; non-terminal reattachment stamps any absent value when writing `running`. A DAG node may remain `scheduled` after its child starts, so only a scheduled, lost task without this stamp is eligible for automatic readmission. Recovery uses `dag.node.retried` with `execAttempt + 1`, capped at three. Stamped lost work folds `task_lost`; legacy unstamped scheduled records remain eligible. A crash after stamping but before invocation conservatively folds `task_lost`. Reconciliation loss reduces the current stored record under its record lock, including when respawn fails after invoking the runner; it must preserve the launch stamp and other facts persisted during respawn.

## Owned children: one cancellation rule (#11381)

- **One child gate** (`child-gate.ts`): may a child of this run start, be revived, be attached or be folded now? It is three rules, one function each, and every point calls them:
  1. no child of the run is live outside a current claim: a superseded attempt's, a removed node's, or a refused turn whose stop is not confirmed (`staleLiveChildren`, with liveness from `isLiveOwnedTask`);
  2. a settled run owes no stop (`outstandingStopRefusal`);
  3. the task in hand is its node's current attempt (`ownedClaimAge`).

  The points are admission, the re-entry sweep, recovery start/attach/fold, explicit send, retry and amend, the self-resume fence, and the read surfaces. They differ only in what they do with a refusal.
- **Resume fence.** A settled child runs again only through the manager's self-resume reopen. The manager asks `owner-resume-fence.ts` inside the record mutation, and the answer rests on the run's checkpoint, which every journal append rewrites synchronously. That gives same-process ordering for the process holding the run; exclusion across processes is the run lease's job.
  - `retire` covers a superseded or removed claim and a cancelled or cancelling run, and ends the child.
  - `hold` covers a current claim of a failed or completed run. It stops only the unsolicited turn and keeps the child resident and send-revivable.
- **Refused turn, stop not confirmed.** The manager marks this (`manager/refused-stops.ts`) in the same step as the refusal, and clears it only when the runner confirms: for a hold, the abort settled and the turn's outcome was observed; for a retire, the teardown settled; or the handle is gone.
  - Until then the task counts as live everywhere (`TaskManager.selfResumeStopPending`). A timed-out or rejected step keeps it (`task_self_resume_stop_unconfirmed`).
  - A cancel awaits or re-issues the stop; a hold becomes a retire once the run is cancelled or cancelling.
  - A send awaits the stop and answers the retryable `unresponsive` while it is unconfirmed.
  - The marker is in memory. An in-process child's turn dies with its process; a host-session child's turn that outlives the process is not re-fenced by a new process (see the #15135 report).
- **Stopping and admitting.**
  - Run cancel drains the run's whole live set to a fixed point and fails with `DagRunChildrenLiveError` while a child stays live.
  - Admission and recovery never start a node while a rule-1 child survives its stop; the ready nodes fail with the retryable `stale_attempt_alive`.
  - The owned start refuses start and reuse while another live claim exists.
  - Recovery stops stale claims before it returns a current one, and reads the current claim again after any awaited stop.
- **Outstanding stop.** It is derived, not stored: a terminal run that still owns a live child owes a stop.
  - Snapshot, wait, attach and list carry `outstandingStop`; the list reads the task records once per batch.
  - The dag tool and the status widget name it.
  - Send, retry and re-entry refuse with `run_still_active`. Amend validates first, then drains, and refuses if a child stays live.

## Conventions

- Policy is fixed inside the definition fingerprint: `dependency-frontier` wave admission (was `strict-barrier` before 2026-08-25), `continue-independent` failure handling, filesystem-only dependency data.
- Run reuse keys on the SUBMITTED definition (canonicalized). Amendments preserve eligible node state and invalidate affected dependents.
- Boundary events are sequenced by the journal writer; live telemetry rides the unsequenced `omo.dag.activity` channel as a separate union.
- Node target rules mirror the task tool: category XOR `subagent_type`, model only with a custom agent route, error codes `both_targets` / `no_target` / `category_with_model` / `agent_with_model`.

## Anti-patterns

- NEVER fold skill content, skill digests, or effective prompts into definition fingerprints; reuse must survive skill materialization changes.
- NEVER key recovery by display attempt; read the persisted `execAttempt` (reattach bumps the display attempt).
- NEVER resume a prior scheduler instance; cancellation deferreds and admission latches are single-shot. Use re-entry / retry / send controls. A re-entry drops `preAttachedTasks`: those ids describe children that were live for the PREVIOUS instance, and re-attaching a settled task folds its outcome onto the node twice.
- NEVER treat a `live_lease` skip as final for an own-session run. The predecessor host that paused the run for its shutdown is usually still draining when the successor resumes the session (omo-desktop RPC restart), so a one-shot claim at `session_start` leaves the run paused forever; watch the reported `holderPid` and claim again when it is gone.
- NEVER probe our own pid for lease liveness. A signal-0 check on `process.pid` is always true, so a saved session reopened in the same multi-session host (fresh runtime, same `parentSessionId`, same pid) would wait for its own host to exit (#8006). For `holderPid === hostPid` the only holder that can matter is a scheduler still registered in this process; ask `isRunHeldInProcess`, and never arm a lease watch on our own pid.
- NEVER block recovery's reconcile loop on a live child. A restart must emit reuse events and `dag.run.resumed` immediately and let the still-running child fold through the normal settle loop, or the run sits in `paused` for as long as the slowest child runs and every operator lever (amend, retry) refuses on `run_still_active`.
- NEVER put activity events or journal seq/lane metadata into boundary builders.
- Missing skills never fail a run; they become `missing_skill` diagnostics. Resumed runs read creation-time materialization, never current `SKILL.md`.
- Wait surfaces resolve (not reject) failed/cancelled runs; callers inspect `DagRunResult`.
- A vanished `<stateDir>/dag/*` directory (worktree cleanup, `rm -rf .omo`) reads as empty through `readDagDirectory` and is recreated by the next checkpoint/event/lock write; it must never surface as an ENOENT from `list`, retention, or recovery. The omo-senpi rpc bridge additionally treats any store read fault on its timer paths as "nothing to publish" (one warning per distinct fault), because a throw there is an `uncaughtException` that ends the session.

## QA

```sh
bun test packages/senpi-task/src/dag
bun test packages/senpi-task/src/dag/scheduler.test.ts   # focused
```

`scheduler-spill.test.ts` sets its own `setDefaultTimeout` floor (20s, 60s on Windows): Bun honours a preload's `setDefaultTimeout` only for the FIRST test file of a run.

Parent: [`../../AGENTS.md`](../../AGENTS.md).
