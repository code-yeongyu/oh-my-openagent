import type { TaskRecord } from "../state"
import { HOST_CHAOS_SESSION, hostChaosIdentity, type HostChaosHarness } from "./chaos-host-harness"

/**
 * The four adversarial things a machine-wide daemon does to its children: it dies (hostKill), it
 * comes back (daemonRestart), it parks an idle session to disk (idleEvict), and it hands its socket
 * to a newer generation that drains the old one (handoff). Each action is deterministic - the mix
 * is what a seed orders, never the action itself.
 */

export type HostChaosAction = "hostKill" | "daemonRestart" | "idleEvict" | "handoff"

export const HOST_CHAOS_ACTIONS: readonly HostChaosAction[] = ["hostKill", "daemonRestart", "idleEvict", "handoff"]

function residents(harness: HostChaosHarness): readonly TaskRecord[] {
  return harness.store.list().records.filter((record) => record.residency_state === "resident")
}

/** The daemon process is gone. Every child it hosted parks and the bounded reconcile runs. */
export async function hostKill(harness: HostChaosHarness): Promise<void> {
  harness.daemon.kill()
  for (const record of residents(harness)) {
    await harness.lifecycle.parkHostSessionOnDaemonLoss(record.task_id)
  }
}

/** A new daemon answers on the same socket; the parked children reattach on the next session start. */
export async function daemonRestart(harness: HostChaosHarness): Promise<void> {
  harness.daemon.alive = true
  for (const taskId of harness.taskIds) harness.daemon.hold(hostChaosIdentity(taskId).session_path)
  await harness.lifecycle.reconcileOnSessionStart(HOST_CHAOS_SESSION)
}

/** The daemon parked an idle session to JSONL: it is no longer live, but it is still reopenable. */
export async function idleEvict(harness: HostChaosHarness): Promise<void> {
  for (const taskId of harness.taskIds) harness.daemon.evict(hostChaosIdentity(taskId).session_path)
  await harness.lifecycle.reconcileOnSessionStart(HOST_CHAOS_SESSION)
}

/** A newer generation took the socket; the old one holds the session paths until it drains. */
export async function handoff(harness: HostChaosHarness): Promise<void> {
  harness.daemon.alive = true
  harness.daemon.drainingAttemptsLeft = 2
  await harness.lifecycle.reconcileOnSessionStart(HOST_CHAOS_SESSION)
}

export function applyHostChaosAction(harness: HostChaosHarness, action: HostChaosAction): Promise<void> {
  switch (action) {
    case "hostKill":
      return hostKill(harness)
    case "daemonRestart":
      return daemonRestart(harness)
    case "idleEvict":
      return idleEvict(harness)
    case "handoff":
      return handoff(harness)
    default:
      return unreachable(action)
  }
}

export type HostChaosViolation = { readonly law: string; readonly detail: string }

/**
 * The four laws a daemon-hosted child lives by, checked after every action mix:
 *  H1 a parked child is never `lost` - its transcript outlives any host.
 *  H2 no pid is ever signalled; a daemon session has none, and the daemon's is not the child's.
 *  H3 a session ends only through the single close writer (or the handle's own close).
 *  H4 a reachable daemon leaves every child continuable: resident, or parked and revivable.
 */
export function collectHostChaosViolations(harness: HostChaosHarness): readonly HostChaosViolation[] {
  const violations: HostChaosViolation[] = []
  for (const record of harness.store.list().records) {
    if (record.status === "lost") {
      violations.push({ law: "H1", detail: `${record.task_id} was marked lost while parked on the daemon` })
    }
    if (record.runner_kind !== "host-session" || record.host_session === undefined) {
      violations.push({ law: "H4", detail: `${record.task_id} lost its host-session identity` })
      continue
    }
    if (record.pid !== undefined) {
      violations.push({ law: "H2", detail: `${record.task_id} carries pid ${record.pid}` })
    }
    if (record.residency_state === "disposed" || record.residency_state === "evicted") {
      violations.push({ law: "H4", detail: `${record.task_id} became ${record.residency_state} instead of parking` })
    }
  }
  if (harness.signals.length > 0) {
    violations.push({ law: "H2", detail: `signals were sent: ${harness.signals.join(",")}` })
  }
  const closedTwice = harness.daemon.closed.filter((path, index) => harness.daemon.closed.indexOf(path) !== index)
  if (closedTwice.length > 0) {
    violations.push({ law: "H3", detail: `sessions closed more than once: ${closedTwice.join(",")}` })
  }
  return violations
}

function unreachable(value: never): never {
  throw new Error(`unhandled host chaos action: ${JSON.stringify(value)}`)
}
