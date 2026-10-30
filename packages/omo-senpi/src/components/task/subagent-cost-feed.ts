import type { TaskRecord } from "@oh-my-opencode/senpi-task"

import type { CapturedUi } from "./runtime-context"
import type { TaskStatusUiDeps } from "./status-ui"
import type { StoreMutation } from "./store-mutation-observer"
import { createSubagentCostLedger } from "./subagent-cost-ledger"

// The footer's subagent tree cost, fed by events: one seed per session (the only full read), then
// each store mutation and each live child message_end updates its run's entry in the ledger, and the
// figure is re-sent only when it changes. A process child's run settling re-reads the tree once, so
// records that child process wrote for its own children are picked up without watching another writer.
export function createTreeCostFeed(deps: Pick<TaskStatusUiDeps, "manager" | "runtime">): { ensureSeeded(): void; observe(change: StoreMutation): void; dispose(): void } {
  const ledger = createSubagentCostLedger()
  const liveSubscriptions = new Map<string, () => void>()
  let seededFor: string | undefined
  // Sessions whose tasks belong to this tree: the root plus every member's own child session. An
  // in-process child records the tasks it spawns with ITSELF as parent and root, so a grandchild is
  // reached through its parent's child_session_id, not through root_session_id.
  const treeSessions = new Set<string>()
  const belongs = (record: TaskRecord): boolean => treeSessions.has(record.parent_session_id) || treeSessions.has(record.root_session_id)
  let published: string | undefined

  const ui = (): CapturedUi | undefined => {
    const captured = deps.runtime.ui()
    const mode = deps.runtime.mode()
    return captured?.setSubagentCost === undefined || (mode !== undefined && mode !== "tui") ? undefined : captured
  }
  const publish = (): void => {
    const target = ui()
    const sessionId = deps.runtime.sessionId()
    if (target === undefined || sessionId === undefined) return
    const total = ledger.total()
    const cost = total > 0 ? total : undefined
    const key = `${sessionId}:${cost ?? "none"}`
    if (key === published) return
    published = key
    target.setSubagentCost?.(cost)
  }
  const unsubscribe = (taskId: string): void => {
    liveSubscriptions.get(taskId)?.()
    liveSubscriptions.delete(taskId)
  }
  const track = (record: TaskRecord): void => {
    if (record.child_session_id !== undefined) treeSessions.add(record.child_session_id)
    ledger.upsertRecord(record)
    if (!ledger.isUnsettled(record.task_id)) return unsubscribe(record.task_id)
    ledger.upsertLive(record.task_id, deps.manager.liveRunStats?.(record.task_id))
    if (liveSubscriptions.has(record.task_id) || deps.manager.subscribeChild === undefined) return
    liveSubscriptions.set(record.task_id, deps.manager.subscribeChild(record.task_id, (event) => {
      if (event.type !== "message_end") return
      ledger.upsertLive(record.task_id, deps.manager.liveRunStats?.(record.task_id))
      publish()
    }))
  }
  const seed = (sessionId: string): void => {
    for (const taskId of [...liveSubscriptions.keys()]) unsubscribe(taskId)
    ledger.clear()
    treeSessions.clear()
    treeSessions.add(sessionId)
    seededFor = sessionId
    const pending = deps.manager.list({ scope: "all" }).map((entry) => entry.record)
    // Closure over child-session links: each pass admits the tasks whose parent joined the tree last pass.
    for (let admitted = true; admitted;) {
      admitted = false
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const record = pending[index]
        if (record === undefined || !belongs(record)) continue
        pending.splice(index, 1)
        track(record)
        admitted = true
      }
    }
  }
  const ensureSeeded = (): void => {
    const sessionId = deps.runtime.sessionId()
    if (ui() === undefined || sessionId === undefined || sessionId === seededFor) return
    seed(sessionId)
    publish()
  }

  return {
    ensureSeeded,
    observe(change) {
      const sessionId = deps.runtime.sessionId()
      if (ui() === undefined || sessionId === undefined) return
      if (sessionId !== seededFor) seed(sessionId)
      if (change.record === null) {
        ledger.remove(change.taskId)
        unsubscribe(change.taskId)
      } else if (belongs(change.record)) {
        // Only a process child's own tasks are written by another process (unseen by this wrapper);
        // an in-process child's tasks arrive here as mutations, so its settle needs no re-read.
        const rereadTree = ledger.isUnsettled(change.taskId) && change.record.run_stats !== undefined && change.record.execution_mode !== "in-process"
        track(change.record)
        if (rereadTree) seed(sessionId)
      }
      publish()
    },
    dispose() {
      for (const taskId of [...liveSubscriptions.keys()]) unsubscribe(taskId)
      ledger.clear()
      treeSessions.clear()
      seededFor = undefined
      published = undefined
    },
  }
}
