import type { BackgroundManager } from "../../features/background-agent"

function taskIsActive(task: { status: string }): boolean {
  return task.status === "running" || task.status === "pending"
}

export function hasActiveBackgroundWork(
  backgroundManager: BackgroundManager | undefined,
  sessionID: string,
): boolean {
  if (!backgroundManager) {
    return false
  }

  return backgroundManager.getAllDescendantTasks(sessionID).some(taskIsActive)
    || backgroundManager.hasPendingParentWakeForSession(sessionID)
    || backgroundManager.hasDispatchedParentWakeForSession(sessionID)
}

export function hasSettlingParentWake(
  backgroundManager: BackgroundManager | undefined,
  sessionID: string,
): boolean {
  return backgroundManager?.hasPendingParentWakeForSession(sessionID) === true
    || backgroundManager?.hasDispatchedParentWakeForSession(sessionID) === true
}
