import type { TaskRecord } from "../state"
import type { DagJournal } from "./journal"
import type { DagRunRecordV1 } from "./manager"
import { resetDagNodes } from "./node-retry"
import type { DagSchedulerOptions } from "./scheduler"
import type { DagNodeId, DagRunEvent } from "./types"

const MAX_INFRASTRUCTURE_RETRIES = 2
const INITIAL_BACKOFF_MS = 1_000

export type RetrySchedule = (callback: () => void, delayMs: number) => () => void
export type InfrastructureRetries = {
  readonly retry: (nodeId: DagNodeId, task: TaskRecord) => void
  readonly pending: (nodeId?: DagNodeId) => boolean
  readonly takeReady: () => boolean
  readonly cancelPendingTimers: () => void
}

type RetriedEvent = Extract<DagRunEvent, { readonly type: "dag.node.retried" }>

/** Only typed infrastructure failures qualify; ordinary child errors never enter this path. */
export function isInfrastructureFailure(task: TaskRecord): boolean {
  if (task.cancel_requested !== undefined) return false
  if (task.status !== "error" && task.status !== "lost") return false
  const kind = task.failure_kind
  switch (kind) {
    case "child-unresponsive":
    case "host_unavailable":
    case "suspended_unresumable":
      return true
    case "session_unavailable":
      return task.failure_reason === "host_draining" || task.failure_reason === "host_memory_pressure"
    case "child-prompt-failed":
    case "child-turn-failed":
    case "session-create-failed":
    case "depth-exceeded":
    case "model_unavailable":
    case "tools_unavailable":
    case undefined:
      return false
    default:
      return assertNever(kind)
  }
}

export function createInfrastructureRetries(
  options: DagSchedulerOptions,
  journal: DagJournal<DagRunRecordV1>,
  wake: () => void,
): InfrastructureRetries {
  const now = options.now ?? Date.now
  const schedule = options.scheduleRetry ?? scheduleTimer
  const counts = new Map<DagNodeId, number>()
  const latest = new Map<DagNodeId, RetriedEvent>()
  const timers = new Map<DagNodeId, () => void>()
  let ready = false
  let disposed = false
  let since = 0
  // Counts belong to the durable run, not a scheduler instance or a display attempt.
  for (;;) {
    const page = options.store.readEvents(journal.snapshot().runId, since, {
      limit: 1000,
      types: ["dag.node.retried"],
    })
    for (const event of page.events) {
      if (event.type !== "dag.node.retried") continue
      latest.set(event.nodeId, event)
      if (event.automatic !== undefined) counts.set(event.nodeId, (counts.get(event.nodeId) ?? 0) + 1)
    }
    if (!page.hasMore) break
    const last = page.events.at(-1)
    if (last === undefined) break
    since = last.seq
  }
  const arm = (nodeId: DagNodeId, delayMs: number): void => {
    timers.set(nodeId, () => undefined)
    const cancel = schedule(() => {
      timers.delete(nodeId)
      if (disposed) return
      ready = true
      wake()
    }, delayMs)
    if (timers.has(nodeId)) timers.set(nodeId, cancel)
  }
  for (const node of journal.snapshot().nodes) {
    const event = latest.get(node.id)
    if (node.state !== "pending" || event?.automatic === undefined || event.execAttempt !== node.execAttempt) continue
    arm(node.id, Math.max(0, Date.parse(event.at) + event.automatic.delayMs - now()))
  }
  return {
    retry(nodeId, task) {
      if (disposed || !isInfrastructureFailure(task)) return
      const count = counts.get(nodeId) ?? 0
      if (count >= MAX_INFRASTRUCTURE_RETRIES) return
      const failureKind = task.failure_kind
      if (failureKind === undefined) return
      const attempt = count + 1
      const delayMs = INITIAL_BACKOFF_MS * 2 ** count
      resetDagNodes(journal, [nodeId], false, { attempt, failureKind, delayMs })
      counts.set(nodeId, attempt)
      journal.append({
        type: "dag.diagnostic.added",
        diagnostic: {
          kind: "node_flag",
          nodeId,
          message: `retried after infra failure (${attempt}/${MAX_INFRASTRUCTURE_RETRIES})`,
          at: new Date(now()).toISOString(),
        },
      })
      arm(nodeId, delayMs)
    },
    pending: (nodeId) => nodeId === undefined ? timers.size > 0 : timers.has(nodeId),
    takeReady() {
      const value = ready
      ready = false
      return value
    },
    cancelPendingTimers() {
      disposed = true
      for (const cancel of timers.values()) cancel()
      timers.clear()
    },
  }
}

function scheduleTimer(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs)
  return () => clearTimeout(timer)
}

function assertNever(value: never): never {
  throw new Error(`unexpected task failure kind ${JSON.stringify(value)}`)
}
