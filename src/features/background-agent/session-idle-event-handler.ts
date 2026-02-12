import { log } from "../../shared"
import { MIN_IDLE_TIME_MS } from "./constants"
import type { BackgroundTask } from "./types"

function getString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key]
  return typeof value === "string" ? value : undefined
}

export function handleSessionIdleBackgroundEvent(args: {
  properties: Record<string, unknown>
  findBySession: (sessionID: string) => BackgroundTask | undefined
  idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>>
  validateSessionHasOutput: (sessionID: string) => Promise<boolean>
  checkSessionTodos: (sessionID: string) => Promise<boolean>
  tryCompleteTask: (task: BackgroundTask, source: string) => Promise<boolean>
  emitIdleEvent: (sessionID: string) => void
}): void {
  const {
    properties,
    findBySession,
    idleDeferralTimers,
    validateSessionHasOutput,
    checkSessionTodos,
    tryCompleteTask,
    emitIdleEvent,
  } = args

  const sessionID = getString(properties, "sessionID")
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
