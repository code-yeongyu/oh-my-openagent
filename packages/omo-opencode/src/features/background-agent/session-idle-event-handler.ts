import { log } from "../../shared"
import { resolveSessionEventID } from "../../shared/event-session-id"
import { MIN_IDLE_TIME_MS } from "./constants"
import type { BackgroundTask } from "./types"

export function handleSessionIdleBackgroundEvent(args: {
  properties: Record<string, unknown>
  findBySession: (sessionID: string) => BackgroundTask | undefined
  idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>>
  validateSessionHasOutput: (sessionID: string) => Promise<boolean>
  checkSessionTodos: (sessionID: string) => Promise<boolean>
  shouldDeferForIncompleteTodos?: (task: BackgroundTask, sessionID: string, source: string) => boolean
  tryCompleteTask: (task: BackgroundTask, source: string) => Promise<boolean>
  emitIdleEvent: (sessionID: string) => void
}): void {
  const {
    properties,
    findBySession,
    idleDeferralTimers,
    validateSessionHasOutput,
    checkSessionTodos,
    shouldDeferForIncompleteTodos,
    tryCompleteTask,
    emitIdleEvent,
  } = args

  const sessionID = resolveSessionEventID(properties)
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

      const completionSource = "session.idle event"
      if (hasIncompleteTodos && (shouldDeferForIncompleteTodos?.(task, sessionID, completionSource) ?? true)) {
        log("[background-agent] Task has incomplete todos, waiting for todo-continuation:", task.id)
        return
      }

      if (task.teamRunId) {
        log("[background-agent] Team member session went idle; skipping background auto-complete:", {
          taskId: task.id,
          teamRunId: task.teamRunId,
        })
        return
      }

      await tryCompleteTask(task, completionSource)
    })
    .catch((err) => {
      log("[background-agent] Error in session.idle handler:", err)
    })
}
