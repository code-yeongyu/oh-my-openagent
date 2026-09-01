import { getTaskToastManager } from "../task-toast-manager"

export function removeTaskToastTracking(taskId: string): void {
  const toastManager = getTaskToastManager()
  if (toastManager) {
    toastManager.removeTask(taskId)
  }
}
