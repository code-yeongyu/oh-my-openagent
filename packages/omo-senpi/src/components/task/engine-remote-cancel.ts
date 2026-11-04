import { log } from "@oh-my-opencode/utils"
import type { RequesterChannel } from "../../../../senpi-task/src/control/requester-channel"
import { writeRegisterLocked } from "../../../../senpi-task/src/control/control-store"
import type { TaskRecord } from "../../../../senpi-task/src/state"
import type { CancelOutcome } from "../../../../senpi-task/src/steering/types"
import type { TaskRecordStore } from "../../../../senpi-task/src/store"

const TERMINAL = new Set(["completed", "error", "cancelled", "interrupted", "lost"])
const nonTerminal = (record: TaskRecord): boolean => record.status === "running" || record.status === "paused" || record.status === "pending"

export type RemoteCancelPorts = {
  readonly channel: RequesterChannel
  readonly store: TaskRecordStore
  readonly finish: (record: TaskRecord) => Promise<unknown>
  readonly holds: (taskId: string) => boolean
  readonly pauseSeq: (parentSessionId: string) => number
  readonly now?: () => number
}

// A cancel of a child another live process owns (design 3.7): carried to that owner as a durable
// cancel_requested plus a sticky `cancelled` register, finished here by the watcher once the owner is
// gone, and refused typed when the owner cannot read the channel. Nothing is ended from here while
// the owner lives.
export function createRemoteCancel(ports: RemoteCancelPorts) {
  const watched = new Set<string>()
  const now = ports.now ?? Date.now

  function register(record: TaskRecord, reason: string | undefined) {
    const cancel = record.cancel_requested ?? { requested_at: new Date(now()).toISOString(), ...(reason === undefined ? {} : { reason }) }
    return { taskId: record.task_id, runEpoch: record.notification.run_epoch, parentSessionId: record.parent_session_id,
      pauseSeq: ports.pauseSeq(record.parent_session_id), runRef: { kind: "task" as const, id: record.task_id }, phase: "cancelled" as const,
      cancel: { requestedAt: cancel.requested_at, ...(cancel.reason === undefined ? {} : { reason: cancel.reason }) } }
  }

  const pending = (record: TaskRecord): CancelOutcome => ({ kind: "cancel_pending", task_id: record.task_id, previous_status: record.status,
    reason: `carried to the live process that owns this child (pid ${record.host_pid ?? "unknown"}); it cancels it on its own handle` })

  function cancel(record: TaskRecord, reason: string | undefined): Promise<CancelOutcome> | undefined {
    if (record.status !== "running" && record.status !== "paused") return undefined
    if (!ports.channel.ownedElsewhere(record)) {
      if (record.cancel_requested === undefined) return undefined
      return ports.finish(record).then(() => ({ kind: "cancelled", task_id: record.task_id, previous_status: record.status }))
    }
    const ownerPid = record.host_pid ?? 0
    if (record.cancel_requested !== undefined) {
      const last = ports.channel.lastAck(record.task_id, record.parent_session_id)
      arm(record.task_id)
      if (last?.state === "refused" && last.reason === "handle_gone") return Promise.resolve({ kind: "owner_cannot_apply", task_id: record.task_id, owner_pid: ownerPid, reason: "handle_gone" })
      return Promise.resolve(pending(record))
    }
    const refused = ports.channel.cannotApply(record)
    if (refused !== undefined) return Promise.resolve({ kind: "owner_cannot_apply", task_id: record.task_id, owner_pid: ownerPid, reason: refused })
    let carried = false
    ports.store.mutate(record.task_id, fresh => {
      if (fresh.cancel_requested !== undefined || !nonTerminal(fresh)) return fresh
      const write = writeRegisterLocked(ports.channel.control, { version: 1, ...register(fresh, reason),
        requester: { pid: process.pid, managerInstance: "requester" }, writtenAt: new Date(now()).toISOString() })
      if (write.kind === "refused") return fresh
      carried = true
      return { ...fresh, cancel_requested: { requested_at: new Date(now()).toISOString(), ...(reason === undefined ? {} : { reason }) } }
    })
    if (!carried) return Promise.resolve({ kind: "noop", task_id: record.task_id, status: record.status, reason: `Task ${record.task_id} could not carry the cancel to its owner.` })
    ports.store.appendEvent(record.task_id, { type: "cancel_requested", payload: { unreachable: true, ...(reason === undefined ? {} : { reason }) } })
    arm(record.task_id)
    return Promise.resolve(pending(record))
  }

  function arm(taskId: string): void { watched.add(taskId) }

  // One watcher tick: a terminal record stops its watch; while the owner lives the sticky register is
  // re-asserted; once the 3.2 predicate is false (dead or cleared host_pid) the cancel is finished here.
  async function tick(): Promise<void> {
    for (const taskId of [...watched]) {
      const record = ports.store.load(taskId) ?? undefined
      if (record === undefined || TERMINAL.has(record.status) || record.cancel_requested === undefined) { watched.delete(taskId); continue }
      if (ports.channel.ownedElsewhere(record)) {
        if (ports.channel.channel) ports.store.mutate(taskId, fresh => { writeRegisterLocked(ports.channel.control, { version: 1, ...register(fresh, undefined),
          requester: { pid: process.pid, managerInstance: "requester" }, writtenAt: new Date(now()).toISOString() }); return fresh })
        continue
      }
      if (ports.holds(taskId)) continue
      watched.delete(taskId)
      await ports.finish(record).catch((error: unknown) => {
        watched.add(taskId)
        log("[omo-senpi] carried cancel could not be finished yet", { taskId, error: String(error) })
      })
    }
  }

  // Re-arm after a restart (design 3.7, r12-2b/r13-1): every flagged non-terminal record of this
  // session's subtree that this manager holds no live handle for, derived from the store.
  function rearm(records: readonly TaskRecord[]): void {
    for (const record of records) if (record.cancel_requested !== undefined && nonTerminal(record) && !ports.holds(record.task_id)) arm(record.task_id)
  }

  return { cancel, tick, rearm, arm, watching: (): readonly string[] => [...watched] }
}
