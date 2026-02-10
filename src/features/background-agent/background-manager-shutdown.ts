import { log } from "../../shared"

import type { BackgroundTask, LaunchInput } from "./types"
import type { ConcurrencyManager } from "./concurrency"
import type { PluginInput } from "@opencode-ai/plugin"

type QueueItem = { task: BackgroundTask; input: LaunchInput }

export function shutdownBackgroundManager(args: {
  shutdownTriggered: { value: boolean }
  stopPolling: () => void
  tasks: Map<string, BackgroundTask>
  client: PluginInput["client"]
  onShutdown?: () => void
  concurrencyManager: ConcurrencyManager
  completionTimers: Map<string, ReturnType<typeof setTimeout>>
  idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>>
  notifications: Map<string, BackgroundTask[]>
  pendingByParent: Map<string, Set<string>>
  queuesByKey: Map<string, QueueItem[]>
  processingKeys: Set<string>
  unregisterProcessCleanup: () => void
}): void {
  const {
    shutdownTriggered,
    stopPolling,
    tasks,
    client,
    onShutdown,
    concurrencyManager,
    completionTimers,
    idleDeferralTimers,
    notifications,
    pendingByParent,
    queuesByKey,
    processingKeys,
    unregisterProcessCleanup,
  } = args

  if (shutdownTriggered.value) return
  shutdownTriggered.value = true

  log("[background-agent] Shutting down BackgroundManager")
  stopPolling()

  for (const task of tasks.values()) {
    if (task.status === "running" && task.sessionID) {
      client.session.abort({ path: { id: task.sessionID } }).catch(() => {})
    }
  }

  if (onShutdown) {
    try {
      onShutdown()
    } catch (error) {
      log("[background-agent] Error in onShutdown callback:", error)
    }
  }

  for (const task of tasks.values()) {
    if (task.concurrencyKey) {
      concurrencyManager.release(task.concurrencyKey)
      task.concurrencyKey = undefined
    }
  }

  for (const timer of completionTimers.values()) clearTimeout(timer)
  completionTimers.clear()

  for (const timer of idleDeferralTimers.values()) clearTimeout(timer)
  idleDeferralTimers.clear()

  concurrencyManager.clear()
  tasks.clear()
  notifications.clear()
  pendingByParent.clear()
  queuesByKey.clear()
  processingKeys.clear()
  unregisterProcessCleanup()

  log("[background-agent] Shutdown complete")
}
