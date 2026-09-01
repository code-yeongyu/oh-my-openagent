import type { TaskRecord } from "../state"
import { CHAOS_MODEL, CHAOS_SESSION } from "./chaos-harness"
import type { ChaosEngine } from "./chaos-engine-factory"
import type { ChaosState } from "./chaos-actions"

function candidates(state: ChaosState, predicate: (record: TaskRecord) => boolean): string[] {
  return state.taskIds.filter((id) => {
    const record = state.harness.store.load(id)
    return record !== null && predicate(record)
  })
}

function pick(state: ChaosState, ids: readonly string[]): string | undefined {
  return ids.length === 0 ? undefined : state.rng.pick(ids)
}

export async function suspendSession(state: ChaosState): Promise<void> {
  state.harness.lifecycleObservations.actionCounts.suspend_session += 1
  // The adapter composes shutdown with the manager's private pending-queue dequeue port. This
  // runner-level harness has no equivalent public seam, so only drive suspension once its queue is
  // empty; pending suspension itself is pinned by lifecycle/shutdown.test.ts.
  if (state.harness.store.list().records.some((record) => record.status === "pending")) return
  await state.harness.engines[0]?.lifecycle.suspendOnSessionShutdown({ parentSessionId: CHAOS_SESSION, reason: "quit" })
}

export async function resumeSession(state: ChaosState, parentSessionId: string): Promise<void> {
  state.harness.lifecycleObservations.actionCounts.resume_session += 1
  await state.harness.engines[1]?.lifecycle.reconcileOnSessionStart(parentSessionId)
  state.harness.observeLiveHandles()
}

export async function crashMidSuspend(state: ChaosState): Promise<void> {
  state.harness.lifecycleObservations.actionCounts.crash_mid_suspend += 1
  const id = pick(state, candidates(state, (record) =>
    record.execution_mode === "process" && record.status === "running" && record.residency_state === "resident"))
  if (id === undefined) return
  const engine = state.harness.engines.find((candidate) => candidate.manager.getResidentHandle(id) !== undefined)
  const handle = engine?.manager.getResidentHandle(id)
  if (engine === undefined || handle === undefined) return
  engine.manager.forget(id)
  await handle.abort()
  await engine.lifecycle.reconcileOnSessionStart(CHAOS_SESSION)
  state.harness.observeLiveHandles()
}

export async function siblingReconcileRace(state: ChaosState): Promise<void> {
  state.harness.lifecycleObservations.actionCounts.sibling_reconcile_race += 1
  await Promise.all(state.harness.engines.slice(0, 2).map((engine) => engine.lifecycle.reconcileOnSessionStart(CHAOS_SESSION)))
  state.harness.observeLiveHandles()
}

function syntheticId(state: ChaosState, offset: number): string {
  const suffix = (0xca00 + state.taskIds.length + offset).toString(16).padStart(4, "0")
  return `st_0000${suffix}`
}

export function observeReclamationPostcondition(
  state: ChaosState,
  taskId: string,
  owner: ChaosEngine | undefined,
): void {
  const record = state.harness.store.load(taskId)
  const attached = owner?.manager.getResidentHandle(taskId) !== undefined
  if (record?.residency_state === "resident" && attached) return
  state.harness.lifecycleObservations.reclamationBreaches.push(
    `orphan ${taskId} remained ownerless after capacity-gated reconcile at full cap`,
  )
}

export async function massReviveAtCap(state: ChaosState): Promise<void> {
  state.harness.lifecycleObservations.actionCounts.mass_revive_at_cap += 1
  const count = state.harness.residencyMax + 2
  for (let index = 0; index < count; index += 1) {
    const taskId = syntheticId(state, index)
    if (state.harness.store.load(taskId) !== null) continue
    const terminal = index >= Math.max(1, state.harness.residencyMax)
    state.harness.store.save({
      task_id: taskId,
      name: taskId,
      parent_session_id: CHAOS_SESSION,
      root_session_id: CHAOS_SESSION,
      depth: 1,
      execution_mode: "in-process",
      model: CHAOS_MODEL,
      status: terminal ? "completed" : "running",
      residency_state: "persisted_only",
      created_at: `2027-01-01T00:00:${index.toString().padStart(2, "0")}.000Z`,
      updated_at: `2027-01-01T00:00:${index.toString().padStart(2, "0")}.000Z`,
      notify_on_terminal: false,
      notification: { run_epoch: index % 3, notified_epoch: -1 },
      spawn_spec: { version: 1, cwd: state.harness.store.stateDir, prompt: `mass ${index}` },
      ...(terminal ? { final_response: "already done" } : {}),
    })
    if (terminal && index !== count - 1) state.harness.writeSession(taskId)
    state.taskIds.push(taskId)
  }
  await Promise.all(state.harness.engines.slice(0, 2).map((engine) => engine.lifecycle.reconcileOnSessionStart(CHAOS_SESSION)))
  state.harness.observeLiveHandles()

  const resident = state.harness.store.list().records.find((record) =>
    record.parent_session_id === CHAOS_SESSION && record.residency_state === "resident" && record.status === "running")
  if (resident === undefined) return
  const owner = state.harness.engines.find((engine) => engine.manager.getResidentHandle(resident.task_id) !== undefined)
  owner?.manager.forget(resident.task_id)
  const before = state.harness.store.load(resident.task_id)?.notification.run_epoch
  await owner?.lifecycle.reconcileOnSessionStart(CHAOS_SESSION)
  const after = state.harness.store.load(resident.task_id)
  observeReclamationPostcondition(state, resident.task_id, owner)
  if (before !== undefined && after?.notification.run_epoch !== before + 1) {
    state.seamBreaches.push(`reclaimed ${resident.task_id} epoch did not advance exactly once`)
  }

  const killed = state.harness.store.list().records.find((record) =>
    record.task_id !== resident.task_id && record.residency_state === "resident" && record.status === "running")
  if (killed === undefined) return
  const killedOwner = state.harness.engines.find((engine) => engine.manager.getResidentHandle(killed.task_id) !== undefined)
  killedOwner?.manager.forget(killed.task_id)
  state.harness.store.mutate(killed.task_id, (fresh) => ({ ...fresh, killed: true }))
  await killedOwner?.lifecycle.reconcileOnSessionStart(CHAOS_SESSION)
  if (state.harness.store.load(killed.task_id)?.residency_state !== "disposed") {
    state.harness.observations.lifecycleBreaches.push(`killed orphan ${killed.task_id} was not disposed`)
  }
}
