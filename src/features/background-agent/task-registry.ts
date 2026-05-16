import type { BackgroundTask } from "./types"

const MAX_COMPLETED_TASK_REGISTRY_SIZE = 100
const REGISTRY_KEY = "__omoBackgroundTaskRegistry"

type BackgroundTaskRegistry = {
  activeTasks: Map<string, BackgroundTask>
  completedTasks: Map<string, BackgroundTask>
}

type GlobalWithBackgroundTaskRegistry = typeof globalThis & {
  [REGISTRY_KEY]?: BackgroundTaskRegistry
}

const TERMINAL_TASK_STATUSES = new Set<BackgroundTask["status"]>([
  "completed",
  "error",
  "cancelled",
  "interrupt",
])

function getRegistry(): BackgroundTaskRegistry {
  const registryGlobal = globalThis as GlobalWithBackgroundTaskRegistry
  registryGlobal[REGISTRY_KEY] ??= {
    activeTasks: new Map<string, BackgroundTask>(),
    completedTasks: new Map<string, BackgroundTask>(),
  }
  return registryGlobal[REGISTRY_KEY]
}

function cloneCompletedTask(task: BackgroundTask): BackgroundTask {
  return {
    id: task.id,
    parentSessionId: task.parentSessionId,
    parentMessageId: task.parentMessageId,
    description: task.description,
    prompt: "[redacted]",
    agent: task.agent,
    sessionId: task.sessionId,
    status: task.status,
    queuedAt: task.queuedAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    model: task.model,
    error: task.error,
    category: task.category,
  }
}

function trimCompletedTasks(registry: BackgroundTaskRegistry): void {
  while (registry.completedTasks.size > MAX_COMPLETED_TASK_REGISTRY_SIZE) {
    const oldestTaskID = registry.completedTasks.keys().next().value
    if (typeof oldestTaskID !== "string") {
      return
    }
    registry.completedTasks.delete(oldestTaskID)
  }
}

export function rememberBackgroundTask(task: BackgroundTask): void {
  const registry = getRegistry()
  registry.completedTasks.delete(task.id)
  registry.activeTasks.set(task.id, task)
}

export function archiveBackgroundTask(task: BackgroundTask): void {
  const registry = getRegistry()
  registry.activeTasks.delete(task.id)
  registry.completedTasks.delete(task.id)
  if (!task.sessionId || !TERMINAL_TASK_STATUSES.has(task.status)) {
    return
  }
  registry.completedTasks.set(task.id, cloneCompletedTask(task))
  trimCompletedTasks(registry)
}

export function getRegisteredBackgroundTask(taskID: string): BackgroundTask | undefined {
  const registry = getRegistry()
  return registry.activeTasks.get(taskID) ?? registry.completedTasks.get(taskID)
}

export function forgetBackgroundTask(taskID: string): void {
  const registry = getRegistry()
  registry.activeTasks.delete(taskID)
  registry.completedTasks.delete(taskID)
}

export function clearBackgroundTaskRegistryForTesting(): void {
  const registry = getRegistry()
  registry.activeTasks.clear()
  registry.completedTasks.clear()
}
