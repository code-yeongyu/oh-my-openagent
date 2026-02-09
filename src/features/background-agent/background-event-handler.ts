import { log } from "../../shared"
import { MIN_IDLE_TIME_MS } from "./constants"
import { subagentSessions } from "../claude-code-session-state"
import type { BackgroundTask } from "./types"

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
    const sessionID = getString(props, "sessionID")
    if (!sessionID) return

    const task = findBySession(sessionID)
    if (!task || task.status !== "running") return

    const startedAt = task.startedAt
    if (!startedAt) return

    const elapsedMs = Date.now() - startedAt.getTime()
    if (elapsedMs < MIN_IDLE_TIME_MS) {
      const remainingMs = MIN_IDLE_TIME_MS - elapsedMs
      if (!idleDeferralTimers.has(task.id)) {
        log("[background-agent] Deferring early session.idle:", {
          elapsedMs,
          remainingMs,
          taskId: task.id,
        })
        const timer = setTimeout(() => {
          idleDeferralTimers.delete(task.id)
          emitIdleEvent(sessionID)
        }, remainingMs)
        idleDeferralTimers.set(task.id, timer)
      } else {
        log("[background-agent] session.idle already deferred:", { elapsedMs, taskId: task.id })
      }
      return
    }

    validateSessionHasOutput(sessionID)
      .then(async (hasValidOutput) => {
        if (task.status !== "running") {
          log("[background-agent] Task status changed during validation, skipping:", {
            taskId: task.id,
            status: task.status,
          })
          return
        }

        if (!hasValidOutput) {
          log("[background-agent] Session.idle but no valid output yet, waiting:", task.id)
          return
        }

        const hasIncompleteTodos = await checkSessionTodos(sessionID)

        if (task.status !== "running") {
          log("[background-agent] Task status changed during todo check, skipping:", {
            taskId: task.id,
            status: task.status,
          })
          return
        }

        if (hasIncompleteTodos) {
          log("[background-agent] Task has incomplete todos, waiting for todo-continuation:", task.id)
          return
        }

        await tryCompleteTask(task, "session.idle event")
      })
      .catch((err) => {
        log("[background-agent] Error in session.idle handler:", err)
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

      const completionTimer = completionTimers.get(task.id)
      if (completionTimer) {
        clearTimeout(completionTimer)
        completionTimers.delete(task.id)
      }

      const idleTimer = idleDeferralTimers.get(task.id)
      if (idleTimer) {
        clearTimeout(idleTimer)
        idleDeferralTimers.delete(task.id)
      }

      cleanupPendingByParent(task)
      tasks.delete(task.id)
      clearNotificationsForTask(task.id)
      if (task.sessionID) {
        subagentSessions.delete(task.sessionID)
      }
    }
  }
}
