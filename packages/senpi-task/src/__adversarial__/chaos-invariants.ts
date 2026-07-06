import { CHAOS_MODEL, CHAOS_SESSION } from "./chaos-harness"
import { flushMicrotasks, isTerminalStatus } from "./chaos-actions"
import type { ChaosState } from "./chaos-actions"

export type InvariantId = 1 | 2 | 3 | 4

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
  const stuck = records.filter((record) => !isTerminalStatus(record.status))
  if (stuck.length > 0) violations.push({ invariant: 3, detail: `${stuck.length} non-terminal task(s) after drain` })

  const probeIds: string[] = []
  let queued = 0
  for (let index = 0; index < state.harness.limit; index += 1) {
    const result = await state.harness.manager.start({
      prompt: "slot probe",
      parent_session_id: CHAOS_SESSION,
      root_session_id: CHAOS_SESSION,
      depth: 1,
      category: "quick",
      model: CHAOS_MODEL,
    })
    if (result.kind !== "started") continue
    probeIds.push(result.task_id)
    if (result.status !== "running") queued += 1
  }
  if (queued > 0) {
    violations.push({ invariant: 3, detail: `slot leak: ${queued}/${state.harness.limit} probe task(s) queued despite all prior tasks terminal` })
  }
  for (const id of probeIds) state.harness.runner.handles.get(id)?.settle({ status: "completed", finalResponse: "probe" })
  await flushMicrotasks()
  return violations
}

export async function collectInvariantViolations(state: ChaosState): Promise<Violation[]> {
  return [...checkExactlyOnce(state), ...checkTerminalIdempotence(state), ...(await checkNoSlotLeak(state))]
}
