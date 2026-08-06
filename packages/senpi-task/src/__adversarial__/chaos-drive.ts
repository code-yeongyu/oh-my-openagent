import { applyRandomAction, flushMicrotasks, isTerminalStatus } from "./chaos-actions"
import type { ChaosState } from "./chaos-actions"
import type { TaskRecord } from "../state"
import { buildHarness, CHAOS_SESSION } from "./chaos-harness"
import { collectInvariantViolations } from "./chaos-invariants"
import {
  crashMidSuspend,
  massReviveAtCap,
  observeReclamationPostcondition,
  resumeSession,
  siblingReconcileRace,
  suspendSession,
} from "./chaos-lifecycle-actions"
import type { Violation } from "./chaos-invariants"
import { RandomSource } from "./prng"

// Force every live and queued task to a terminal outcome so the slot / queue invariant can be
// checked against a fully quiesced system. Settling every handle each round releases occupied slots
// (including revived and late-launched children) and lets the queue drain deterministically.
async function drain(state: ChaosState): Promise<void> {
  const cap = state.taskIds.length * 8 + 80
  for (let round = 0; round < cap; round += 1) {
    const before = state.harness.runner.handles.size
    for (const engine of state.harness.engines) {
      for (const handle of engine.inProcessRunner.allHandles) handle.settle({ status: "completed", finalResponse: "drain" })
      for (const handle of engine.processRunner.allHandles) handle.settle({ status: "completed", finalResponse: "drain" })
    }
    state.harness.waiters.advance()
    for (const engine of state.harness.engines) {
      await engine.lifecycle.admitResident(CHAOS_SESSION)
      await engine.lifecycle.reconcileOnSessionStart(CHAOS_SESSION)
    }
    state.harness.notifier.flushBuffered({ sessionId: CHAOS_SESSION, replaced: false })
    state.harness.notifier.reconcileFailedNotifications({ sessionId: CHAOS_SESSION, parentState: { kind: "idle" } })
    const pendingRetries = state.harness.retryScheduler.pendingCount
    if (pendingRetries > 0) state.harness.retryScheduler.run(state.rng.int(0, pendingRetries - 1))
    await flushMicrotasks()
    await flushMicrotasks()
    const records = state.harness.store.list().records
    const allTerminal = records.every((record) => isTerminalStatus(record.status))
    const anyPending = records.some((record) => record.status === "pending")
    const grew = state.harness.runner.handles.size > before
    const notificationsSettled = state.harness.retryScheduler.pendingCount === 0
      && state.harness.notifier.bufferedCount(CHAOS_SESSION) === 0
    if (allTerminal && !anyPending && !grew && notificationsSettled) break
  }
  state.harness.waiters.abortAll()
  await flushMicrotasks()
  await flushMicrotasks()
}

export type IterationReport = {
  readonly steps: number
  readonly tasks: number
  readonly violations: readonly Violation[]
}

// Run one fully-isolated chaos iteration for a given seed and return any invariant violations. The
// harness (temp state dir) is always disposed, pass or fail.
function makeState(seed: number, concurrency: number, residencyMax: number, maxTasks: number): ChaosState {
  const rng = new RandomSource(seed)
  return {
    harness: buildHarness({ concurrency, residencyMax, maxDepth: 3 }),
    rng,
    taskIds: [],
    background: new Map(),
    seamBreaches: [],
    observedEdges: new Set(),
    maxTasks,
  }
}

export async function runIteration(seed: number): Promise<IterationReport> {
  const rng = new RandomSource(seed)
  const concurrency = rng.int(1, 4)
  const residencyMax = rng.int(1, 4)
  const maxTasks = rng.int(3, 8)
  const state = makeState(seed, concurrency, residencyMax, maxTasks)
  const harness = state.harness
  try {
    const steps = rng.int(12, 30)
    for (let step = 0; step < steps; step += 1) await applyRandomAction(state)
    await drain(state)
    const violations = await collectInvariantViolations(state)
    return { steps, tasks: state.taskIds.length, violations }
  } finally {
    harness.cleanup()
  }
}

export type LifecycleMutation =
  | "double_revive"
  | "lose_recoverable"
  | "suspension_bumps_epoch"
  | "spawn_before_orphan_kill"
  | "revive_forbidden"
  | "over_admit"
  | "capacity_gate_reclamation"
  | "relaunch_terminal_without_session"

export type LifecycleProbeReport = {
  readonly actionCounts: ChaosState["harness"]["lifecycleObservations"]["actionCounts"]
  readonly violations: readonly Violation[]
}

async function startProbeTask(state: ChaosState, mode: "in-process" | "process", prompt: string): Promise<string> {
  const result = await state.harness.manager.start({
    prompt,
    parent_session_id: CHAOS_SESSION,
    root_session_id: CHAOS_SESSION,
    depth: 1,
    category: "quick",
    model: state.harness.model,
    execution_mode: mode,
    run_in_background: true,
  })
  if (result.kind !== "started") throw new Error(`probe start failed: ${result.kind}`)
  state.taskIds.push(result.task_id)
  state.background.set(result.task_id, true)
  return result.task_id
}

export async function runLifecycleProbe(): Promise<LifecycleProbeReport> {
  const state = makeState(0x21ca05, 8, 3, 20)
  try {
    await startProbeTask(state, "in-process", "suspend and resume")
    await startProbeTask(state, "process", "crash during suspend")
    await suspendSession(state)
    await resumeSession(state, CHAOS_SESSION)
    await startProbeTask(state, "process", "retained pid")
    await crashMidSuspend(state)
    await siblingReconcileRace(state)
    await massReviveAtCap(state)
    await drain(state)
    return {
      actionCounts: { ...state.harness.lifecycleObservations.actionCounts },
      violations: await collectInvariantViolations(state),
    }
  } finally {
    state.harness.cleanup()
  }
}

function seedMutationRecord(state: ChaosState, taskId: string, overrides: Partial<TaskRecord> = {}): void {
  const base = {
    task_id: taskId,
    name: taskId,
    parent_session_id: CHAOS_SESSION,
    root_session_id: CHAOS_SESSION,
    depth: 1,
    execution_mode: "in-process",
    model: state.harness.model,
    status: "running" as const,
    residency_state: "persisted_only" as const,
    created_at: "2027-01-01T00:00:00.000Z",
    updated_at: "2027-01-01T00:00:00.000Z",
    notify_on_terminal: false,
    notification: { run_epoch: 4, notified_epoch: -1 },
    spawn_spec: { version: 1 as const, cwd: state.harness.store.stateDir, prompt: "mutation" },
  }
  state.harness.store.save({ ...base, ...overrides })
  state.taskIds.push(taskId)
}

export async function runLifecycleMutationProbe(mutation: LifecycleMutation): Promise<LifecycleProbeReport> {
  const state = makeState(0x21bad, 4, 1, 8)
  try {
    const taskId = "st_0000bad0"
    if (mutation === "double_revive") {
      const started = await startProbeTask(state, "in-process", "double claim")
      const first = state.harness.engines[0]
      const second = state.harness.engines[1]
      if (first === undefined || second === undefined) throw new Error("mutation engines unavailable")
      state.harness.store.mutate(started, (record) => ({ ...record, host_pid: second.hostPid }))
      const record = state.harness.store.load(started)
      if (record === null) throw new Error("mutation record missing")
      const handle = await second.inProcessRunner.start({
        taskId: started, cwd: state.harness.store.stateDir, stateDir: state.harness.store.stateDir,
        prompt: "double claim", depth: 1, parentSessionId: CHAOS_SESSION, rootSessionId: CHAOS_SESSION,
      })
      await second.manager.reattach(record, handle)
      state.harness.observeLiveHandles()
    } else if (mutation === "lose_recoverable") {
      seedMutationRecord(state, taskId)
      const record = state.harness.store.load(taskId)
      if (record !== null) state.harness.store.replace({ ...record, status: "lost", error_message: "mutant" })
    } else if (mutation === "suspension_bumps_epoch") {
      seedMutationRecord(state, taskId, { residency_state: "resident" })
      const record = state.harness.store.load(taskId)
      if (record !== null) state.harness.store.replace({ ...record, residency_state: "persisted_only", notification: { ...record.notification, run_epoch: 5 } })
    } else if (mutation === "spawn_before_orphan_kill") {
      const pid = state.harness.processes.spawn()
      seedMutationRecord(state, taskId, { execution_mode: "process", residency_state: "resident", pid })
      await state.harness.engines[0]?.processRunner.start({
        taskId, cwd: state.harness.store.stateDir, stateDir: state.harness.store.stateDir,
        prompt: "mutant", depth: 1, parentSessionId: CHAOS_SESSION, rootSessionId: CHAOS_SESSION,
      })
    } else if (mutation === "revive_forbidden") {
      seedMutationRecord(state, taskId, { status: "cancelled", residency_state: "disposed" })
      state.harness.store.mutate(taskId, (record) => ({ ...record, status: "running", residency_state: "resident" }))
    } else if (mutation === "over_admit") {
      seedMutationRecord(state, "st_0000bad1", { residency_state: "resident" })
      seedMutationRecord(state, "st_0000bad2", { residency_state: "resident" })
    } else if (mutation === "capacity_gate_reclamation") {
      const owner = state.harness.engines[0]
      if (owner === undefined) throw new Error("capacity-gate mutation owner unavailable")
      seedMutationRecord(state, taskId, { residency_state: "resident", host_pid: owner.hostPid })
      // Mutant: route resident-orphan reclamation through ordinary admission. Because the orphan
      // itself consumes the only slot, admission rejects and the buggy reconcile path returns
      // without running reclaimOrphanedResident.
      const admission = await owner.lifecycle.admitResident(CHAOS_SESSION)
      if (admission.kind !== "rejected") throw new Error("capacity-gate mutation did not reach a full cap")
      observeReclamationPostcondition(state, taskId, owner)
    } else {
      seedMutationRecord(state, taskId, { status: "completed", final_response: "done" })
      await state.harness.engines[0]?.inProcessRunner.start({
        taskId, cwd: state.harness.store.stateDir, stateDir: state.harness.store.stateDir,
        prompt: "mutant", depth: 1, parentSessionId: CHAOS_SESSION, rootSessionId: CHAOS_SESSION,
      })
    }
    return {
      actionCounts: { ...state.harness.lifecycleObservations.actionCounts },
      violations: await collectInvariantViolations(state),
    }
  } finally {
    state.harness.cleanup()
  }
}
