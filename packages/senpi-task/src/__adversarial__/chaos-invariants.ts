import type { ChaosState } from "./chaos-actions"
import { isTerminalStatus } from "./observing-store"

export type InvariantId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13

export type Violation = {
  readonly invariant: InvariantId
  readonly detail: string
}

// Invariant 1: exactly-once notification per (task_id, run_epoch). Two independent witnesses: the
// persisted notified_epoch never advances twice for one epoch, and every notify/flush result maps
// to exactly the enqueue count it claims.
function checkExactlyOnce(state: ChaosState): Violation[] {
  const violations: Violation[] = []
  for (const [key, count] of state.harness.observations.enqueueByEpoch) {
    if (count > 1) violations.push({ invariant: 1, detail: `parent enqueued ${count} times for (task:epoch) ${key}` })
  }
  for (const [key, count] of state.harness.observations.notifyCommits) {
    if (count > 1) violations.push({ invariant: 1, detail: `notification persisted ${count} times for ${key}` })
  }
  for (const breach of state.seamBreaches) violations.push({ invariant: 1, detail: breach })
  return violations
}

// Invariant 2: terminal idempotence. The observing store records any late status transition that
// was applied (or not logged) and any replace that overwrote a terminal without a fresh epoch.
function checkTerminalIdempotence(state: ChaosState): Violation[] {
  return state.harness.observations.breaches
    .filter((breach) => breach.invariant === 2)
    .map((breach) => ({ invariant: 2 as const, detail: breach.detail }))
}

// Invariant 3: no concurrency slot leak. After draining every task to terminal the queue must be
// empty and every slot released, proven by starting a fresh full batch that must all run.
async function checkNoSlotLeak(state: ChaosState): Promise<Violation[]> {
  const violations: Violation[] = []
  const records = state.harness.store.list().records
  const pending = records.filter((record) => record.status === "pending")
  if (pending.length > 0) violations.push({ invariant: 3, detail: `${pending.length} task(s) still pending after drain` })
  const stuck = records.filter((record) =>
    !isTerminalStatus(record.status) && record.residency_state !== "disposed" && record.residency_state !== "evicted")
  if (stuck.length > 0) {
    const detail = stuck.map((record) => {
      const owners = state.harness.engines.filter((engine) => engine.manager.getResidentHandle(record.task_id) !== undefined).map((engine) => engine.id)
      return `${record.task_id}:${record.status}/${record.residency_state}:host=${record.host_pid ?? "none"}:handles=${owners.join("+") || "none"}`
    }).join(",")
    violations.push({ invariant: 3, detail: `${stuck.length} non-terminal task(s) after drain: ${detail}` })
  }

  const probeIds: string[] = []
  let queued = 0
  for (let index = 0; index < state.harness.limit; index += 1) {
    const result = await state.harness.probeEngine.manager.start({
      prompt: "slot probe",
      parent_session_id: state.harness.sessionId,
      root_session_id: state.harness.sessionId,
      depth: 1,
      category: "quick",
      model: state.harness.model,
    })
    if (result.kind !== "started") continue
    probeIds.push(result.task_id)
    if (result.status !== "running") queued += 1
  }
  if (queued > 0) {
    violations.push({ invariant: 3, detail: `slot leak: ${queued}/${state.harness.limit} probe task(s) queued despite all prior tasks terminal` })
  }
  for (const id of probeIds) {
    for (const handle of state.harness.probeEngine.inProcessRunner.allHandles.filter((entry) => entry.handle.task_id === id)) {
      handle.settle({ status: "completed", finalResponse: "probe" })
    }
    for (const handle of state.harness.probeEngine.processRunner.allHandles.filter((entry) => entry.handle.task_id === id)) {
      handle.settle({ status: "completed", finalResponse: "probe" })
    }
  }
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  return violations
}

// Invariant 5: every instrumented waitFor call settles by quiescence, and a task whose persisted
// cancel event says previous_status=pending never crosses the runner start boundary.
function checkWaitersAndPendingCancellation(state: ChaosState): Violation[] {
  const violations: Violation[] = []
  const { registrations, settlements } = state.harness.waiters
  if (settlements !== registrations) {
    violations.push({ invariant: 5, detail: `waitFor settled ${settlements}/${registrations} registered waiter(s)` })
  }
  const started = new Set(state.harness.runner.startedTaskIds)
  for (const taskId of state.harness.pendingCancelledTaskIds) {
    if (started.has(taskId)) {
      violations.push({ invariant: 5, detail: `task ${taskId} cancelled from pending reached runner start` })
    }
  }
  return violations
}

function checkLifecycleInvariants(state: ChaosState): Violation[] {
  const violations: Violation[] = []
  for (const detail of state.harness.lifecycleObservations.liveHandleBreaches) {
    violations.push({ invariant: 6, detail })
  }
  for (const detail of state.harness.observations.lifecycleBreaches) {
    const invariant = detail.includes("recoverable") ? 7
      : detail.includes("run_epoch") || detail.includes("suspension") ? 8
      : 10
    violations.push({ invariant, detail })
  }
  for (const detail of state.harness.lifecycleObservations.pidBreaches) {
    violations.push({ invariant: 9, detail })
  }
  const referencedPids = new Set(
    state.harness.store.list().records.flatMap((record) => record.pid === undefined ? [] : [record.pid]),
  )
  for (const pid of state.harness.processes.alive) {
    if (pid >= 20_000 && !referencedPids.has(pid)) {
      violations.push({ invariant: 9, detail: `orphan fake pid ${pid} remained alive after reconcile` })
    }
  }
  const killedResidents = state.harness.store.list().records.filter((record) => record.killed === true && record.residency_state === "resident")
  for (const record of killedResidents) {
    violations.push({ invariant: 10, detail: `killed task ${record.task_id} still pins a residency slot` })
  }
  const maxResidents = state.harness.observations.maxResidentsByParent.get(state.harness.sessionId) ?? 0
  if (maxResidents > state.harness.residencyMax) {
    violations.push({ invariant: 11, detail: `resident count ${maxResidents} exceeded cap ${state.harness.residencyMax}` })
  }
  for (const detail of state.harness.lifecycleObservations.reclamationBreaches) {
    violations.push({ invariant: 12, detail })
  }
  for (const detail of state.harness.lifecycleObservations.terminalRelaunches) {
    violations.push({ invariant: 13, detail: `terminal record without session relaunched: ${detail}` })
  }
  return violations
}

export async function collectInvariantViolations(state: ChaosState): Promise<Violation[]> {
  return [
    ...checkExactlyOnce(state),
    ...checkTerminalIdempotence(state),
    ...(await checkNoSlotLeak(state)),
    ...checkWaitersAndPendingCancellation(state),
    ...checkLifecycleInvariants(state),
  ]
}
