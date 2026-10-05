import {
  createChildProgress,
  runTaskCancel,
  runTaskOutput,
  runTaskSend,
  type ManagedChildEvent,
  type TaskRecord,
} from "@oh-my-opencode/senpi-task"

import type { SenpiExtensionAPI } from "../../extension/types"
import type { TaskEngine } from "./engine"
import {
  boundedTaskOutput,
  invalidArguments,
  liveProgressSnapshot,
  parseTaskCancel,
  parseTaskOutput,
  parseTaskSend,
  taskSnapshot,
  type TaskLiveProgressSnapshot,
} from "./task-rpc-codec"

const TASK_UPDATED_EVENT = "omo.task.updated"
const MAX_TASK_SNAPSHOTS = 256
// Trailing-edge window for progress-driven snapshot pushes. Every accepted child progress event of
// every live task used to emit a full session snapshot (up to 256 records), so a burst of distinct
// ticks pushed hundreds of snapshots back-to-back and overflowed the desktop RPC socket queue
// (senpi#1438; the 4 MiB cap and teardown-on-overflow on the consumer side are intentional). 150ms
// is below a UI flicker threshold yet collapses a whole burst into one push of the freshest state;
// lifecycle-driven attach/sync still emit immediately, so only progress tail latency is affected.
const PROGRESS_COALESCE_MS = 150

type TimerHandle = ReturnType<typeof setTimeout> | number

// Injectable timer seam so the coalescing window is deterministic under test; defaults to global
// timers, unref'd so a queued flush never holds the host process open.
export interface TaskRpcTimers {
  set(callback: () => void, ms: number): TimerHandle
  clear(handle: TimerHandle): void
}

export interface TaskRpcBridgeDeps {
  readonly timers?: TaskRpcTimers
  readonly coalesceMs?: number
}

const globalTimers: TaskRpcTimers = {
  set: (callback, ms) => {
    const handle = setTimeout(callback, ms)
    handle.unref?.()
    return handle
  },
  clear: (handle) => clearTimeout(handle),
}

export interface TaskRpcBridge {
  attach(): void
  sync(): void
  detach(): void
  dispose(): void
}

export function wireTaskRpcBridge(
  pi: SenpiExtensionAPI,
  engine: TaskEngine,
  deps: TaskRpcBridgeDeps = {},
): TaskRpcBridge {
  const timers = deps.timers ?? globalTimers
  const coalesceMs = deps.coalesceMs ?? PROGRESS_COALESCE_MS
  const subscriptions = new Map<string, () => void>()
  const liveProgress = new Map<string, TaskLiveProgressSnapshot>()
  let activeSessionId: string | undefined
  let lastSnapshot: string | undefined
  let disposed = false
  let pendingFlush: TimerHandle | undefined

  const cancelPendingFlush = (): void => {
    if (pendingFlush === undefined) return
    timers.clear(pendingFlush)
    pendingFlush = undefined
  }

  const recordsForSession = (sessionId: string) => {
    const all = engine.manager.list({ scope: "parent-session", session_id: sessionId }).map((entry) => entry.record)
    const truncatedTasks = Math.max(0, all.length - MAX_TASK_SNAPSHOTS)
    if (truncatedTasks === 0) return { records: all, truncatedTasks }
    const live = all.filter(isLive).slice(-MAX_TASK_SNAPSHOTS)
    const terminalSlots = MAX_TASK_SNAPSHOTS - live.length
    return {
      records: [
        ...live,
        ...(terminalSlots === 0 ? [] : all.filter((record) => !isLive(record)).slice(-terminalSlots)),
      ],
      truncatedTasks,
    }
  }

  const emit = (selection = activeSessionId === undefined ? undefined : recordsForSession(activeSessionId)): void => {
    const sessionId = activeSessionId
    if (disposed || sessionId === undefined || pi.rpc?.emit === undefined) return
    if (selection === undefined) return
    const data = {
      parent_session_id: sessionId,
      tasks: selection.records.map((record) =>
        taskSnapshot(
          record,
          isLive(record) ? engine.manager.runStatsSnapshot?.(record.task_id) : undefined,
          liveProgress.get(record.task_id),
        ),
      ),
      ...(selection.truncatedTasks === 0 ? {} : { truncated_tasks: selection.truncatedTasks }),
    }
    const fingerprint = JSON.stringify(data)
    if (fingerprint === lastSnapshot) return
    lastSnapshot = fingerprint
    pi.rpc.emit(TASK_UPDATED_EVENT, data)
  }

  const scheduleProgressFlush = (): void => {
    if (disposed || activeSessionId === undefined) return
    // Trailing edge, latest-wins: the first tick opens the window, later ticks only mean the
    // flush re-reads the store, so a burst costs exactly one snapshot push.
    if (pendingFlush !== undefined) return
    pendingFlush = timers.set(() => {
      pendingFlush = undefined
      emit()
    }, coalesceMs)
  }

  const removeSubscription = (taskId: string): void => {
    subscriptions.get(taskId)?.()
    subscriptions.delete(taskId)
    liveProgress.delete(taskId)
  }

  const syncSubscriptions = (records: readonly TaskRecord[]): void => {
    const liveIds = new Set(
      records
        .filter((record) => isLive(record) && record.residency_state === "resident")
        .map((record) => record.task_id),
    )
    for (const taskId of subscriptions.keys()) {
      if (!liveIds.has(taskId)) removeSubscription(taskId)
    }
    for (const record of records) {
      if (!liveIds.has(record.task_id) || subscriptions.has(record.task_id)) continue
      const progress = createChildProgress(
        record.task_id,
        {
          name: record.name,
          taskSummary: record.task_summary,
          description: record.description,
          category: record.category,
          agentType: record.agent_type,
          resolvedModel: record.resolved_model,
          model: record.model,
        },
        Date.parse(record.created_at),
      )
      const unsubscribe = engine.manager.subscribeChild(record.task_id, (event: ManagedChildEvent) => {
        if (!progress.accept(event)) return
        liveProgress.set(record.task_id, liveProgressSnapshot(progress.details()))
        scheduleProgressFlush()
      })
      subscriptions.set(record.task_id, unsubscribe)
    }
  }

  const detach = (): void => {
    cancelPendingFlush()
    for (const taskId of [...subscriptions.keys()]) removeSubscription(taskId)
    activeSessionId = undefined
    lastSnapshot = undefined
  }

  const sync = (): void => {
    const sessionId = activeSessionId
    if (sessionId === undefined || pi.rpc?.emit === undefined) return
    // Emit immediately and drop any queued progress flush so ordering stays monotonic: the
    // lifecycle snapshot below is at least as fresh as anything the flush would have sent.
    cancelPendingFlush()
    const selection = recordsForSession(sessionId)
    syncSubscriptions(selection.records)
    emit(selection)
  }

  registerTaskHandlers(pi, engine, () => (disposed ? undefined : activeSessionId))

  return {
    attach() {
      if (disposed) return
      detach()
      activeSessionId = engine.runtime.sessionId()
      sync()
    },
    sync,
    detach,
    dispose() {
      if (disposed) return
      disposed = true
      detach()
    },
  }
}

function registerTaskHandlers(
  pi: SenpiExtensionAPI,
  engine: TaskEngine,
  currentSessionId: () => string | undefined,
): void {
  const handle = pi.rpc?.handle
  if (handle === undefined) return
  handle("omo.task.send", async (data) => {
    const sessionId = currentSessionId()
    if (sessionId === undefined) return unavailable()
    const input = parseTaskSend(data)
    if ("error" in input) return invalidArguments(input.error)
    const record = engine.manager.get(input.value.to)
    if (record === undefined || record.parent_session_id !== sessionId) return notFound()
    return (await runTaskSend(engine.manager, input.value, sessionId)).details
  })
  handle("omo.task.cancel", async (data) => {
    const sessionId = currentSessionId()
    if (sessionId === undefined) return unavailable()
    const input = parseTaskCancel(data)
    if ("error" in input) return invalidArguments(input.error)
    const record = engine.manager.get(input.value.task_id)
    if (record === undefined || record.parent_session_id !== sessionId) return notFound()
    return (await runTaskCancel(engine.manager, input.value)).details
  })
  handle("omo.task.output", async (data) => {
    const sessionId = currentSessionId()
    if (sessionId === undefined) return unavailable()
    const input = parseTaskOutput(data)
    if ("error" in input) return invalidArguments(input.error)
    return boundedTaskOutput((
      await runTaskOutput({ manager: engine.manager, stateDir: engine.stateDir }, input.value, sessionId)
    ).details)
  })
}

function isLive(record: TaskRecord): boolean {
  return record.status === "pending" || record.status === "running"
}

function unavailable() {
  return { kind: "unavailable", reason: "No active parent session." } as const
}

function notFound() {
  return { kind: "not_found", reason: "Task not found." } as const
}
