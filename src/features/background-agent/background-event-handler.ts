import { log } from "../../shared"
import type { BackgroundTask } from "./types"
import { cleanupTaskAfterSessionEnds } from "./session-task-cleanup"
import { handleSessionIdleBackgroundEvent } from "./session-idle-event-handler"

type Event = { type: string; properties?: Record<string, unknown> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key]
  return typeof value === "string" ? value : undefined
}

export function handleBackgroundEvent(args: {
  event: Event
  findBySession: (sessionID: string) => BackgroundTask | undefined
  getAllDescendantTasks: (sessionID: string) => BackgroundTask[]
  releaseConcurrencyKey?: (key: string) => void
  cancelTask: (
    taskId: string,
    options: { source: string; reason: string; skipNotification: true }
  ) => Promise<boolean>
  tryCompleteTask: (task: BackgroundTask, source: string) => Promise<boolean>
  validateSessionHasOutput: (sessionID: string) => Promise<boolean>
  checkSessionTodos: (sessionID: string) => Promise<boolean>
  idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>>
  completionTimers: Map<string, ReturnType<typeof setTimeout>>
  tasks: Map<string, BackgroundTask>
  cleanupPendingByParent: (task: BackgroundTask) => void
  clearNotificationsForTask: (taskId: string) => void
  emitIdleEvent: (sessionID: string) => void
}): void {
  const {
    event,
    findBySession,
    getAllDescendantTasks,
    releaseConcurrencyKey,
    cancelTask,
    tryCompleteTask,
    validateSessionHasOutput,
    checkSessionTodos,
    idleDeferralTimers,
    completionTimers,
    tasks,
    cleanupPendingByParent,
    clearNotificationsForTask,
    emitIdleEvent,
  } = args

  const props = event.properties

  if (event.type === "message.part.updated") {
    if (!props || !isRecord(props)) return
    const sessionID = getString(props, "sessionID")
    if (!sessionID) return

    const task = findBySession(sessionID)
    if (!task) return

    const existingTimer = idleDeferralTimers.get(task.id)
    if (existingTimer) {
      clearTimeout(existingTimer)
      idleDeferralTimers.delete(task.id)
    }

    const type = getString(props, "type")
    const tool = getString(props, "tool")

    if (type === "tool" || tool) {
      if (!task.progress) {
        task.progress = { toolCalls: 0, lastUpdate: new Date() }
      }
      task.progress.toolCalls += 1
      task.progress.lastTool = tool
      task.progress.lastUpdate = new Date()
    }
  }

  if (event.type === "session.idle") {
    if (!props || !isRecord(props)) return
    handleSessionIdleBackgroundEvent({
      properties: props,
      findBySession,
      idleDeferralTimers,
      validateSessionHasOutput,
      checkSessionTodos,
      tryCompleteTask,
      emitIdleEvent,
    })
  }

  if (event.type === "session.error") {
    if (!props || !isRecord(props)) return
    const sessionID = getString(props, "sessionID")
    if (!sessionID) return

    const task = findBySession(sessionID)
    if (!task || task.status !== "running") return

    const errorRaw = props["error"]
    const dataRaw = isRecord(errorRaw) ? errorRaw["data"] : undefined
    const message =
      (isRecord(dataRaw) ? getString(dataRaw, "message") : undefined) ??
      (isRecord(errorRaw) ? getString(errorRaw, "message") : undefined) ??
      "Session error"

    task.status = "error"
    task.error = message
    task.completedAt = new Date()

    cleanupTaskAfterSessionEnds({
      task,
      tasks,
      idleDeferralTimers,
      completionTimers,
      cleanupPendingByParent,
      clearNotificationsForTask,
      releaseConcurrencyKey,
    })
  }

  if (event.type === "session.deleted") {
    if (!props || !isRecord(props)) return
    const infoRaw = props["info"]
    if (!isRecord(infoRaw)) return
    const sessionID = getString(infoRaw, "id")
    if (!sessionID) return

    const tasksToCancel = new Map<string, BackgroundTask>()
    const directTask = findBySession(sessionID)
    if (directTask) {
      tasksToCancel.set(directTask.id, directTask)
    }
    for (const descendant of getAllDescendantTasks(sessionID)) {
      tasksToCancel.set(descendant.id, descendant)
    }
    if (tasksToCancel.size === 0) return

    for (const task of tasksToCancel.values()) {
      if (task.status === "running" || task.status === "pending") {
        void cancelTask(task.id, {
          source: "session.deleted",
          reason: "Session deleted",
          skipNotification: true,
        }).catch((err) => {
          log("[background-agent] Failed to cancel task on session.deleted:", {
            taskId: task.id,
            error: err,
          })
        })
      }

      cleanupTaskAfterSessionEnds({
        task,
        tasks,
        idleDeferralTimers,
        completionTimers,
        cleanupPendingByParent,
        clearNotificationsForTask,
        releaseConcurrencyKey,
      })
    }
  }
}
