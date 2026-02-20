import { subagentSessions } from "../claude-code-session-state"
import type { BackgroundTask } from "./types"

export function cleanupTaskAfterSessionEnds(args: {
  task: BackgroundTask
  tasks: Map<string, BackgroundTask>
  idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>>
  completionTimers: Map<string, ReturnType<typeof setTimeout>>
  cleanupPendingByParent: (task: BackgroundTask) => void
  clearNotificationsForTask: (taskId: string) => void
  releaseConcurrencyKey?: (key: string) => void
}): void {
  const {
    task,
    tasks,
    idleDeferralTimers,
    completionTimers,
    cleanupPendingByParent,
    clearNotificationsForTask,
    releaseConcurrencyKey,
  } = args

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

  if (task.concurrencyKey && releaseConcurrencyKey) {
    releaseConcurrencyKey(task.concurrencyKey)
    task.concurrencyKey = undefined
  }

  cleanupPendingByParent(task)
  clearNotificationsForTask(task.id)
  tasks.delete(task.id)
  if (task.sessionID) {
    subagentSessions.delete(task.sessionID)
  }
}
