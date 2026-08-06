import type { BackgroundTask } from "./types"

const MAX_COMPLETED_TASK_REGISTRY_SIZE = 100
const REGISTRY_KEY = "__omoBackgroundTaskRegistry"

type BackgroundTaskRegistry = {
  activeTasks: Map<string, () => BackgroundTask>
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
    activeTasks: new Map<string, () => BackgroundTask>(),
    completedTasks: new Map<string, BackgroundTask>(),
  }
  const registry = registryGlobal[REGISTRY_KEY]
  return registry
}

function cloneProgress(progress: BackgroundTask["progress"]): BackgroundTask["progress"] {
  if (!progress) {
    return undefined
  }

  return {
    ...progress,
    countedToolPartIDs: progress.countedToolPartIDs ? new Set(progress.countedToolPartIDs) : undefined,
  }
}

function cloneAttempts(attempts: BackgroundTask["attempts"]): BackgroundTask["attempts"] {
  if (!attempts) {
    return undefined
  }

  return attempts.map((attempt) => ({ ...attempt }))
}

function cloneRegisteredTask(task: BackgroundTask): BackgroundTask {
  return {
    id: task.id,
    rootSessionId: task.rootSessionId,
    parentSessionId: task.parentSessionId,
    parentMessageId: task.parentMessageId,
    teamRunId: task.teamRunId,
    description: task.description,
    prompt: "[redacted]",
    agent: task.agent,
    spawnDepth: task.spawnDepth,
    sessionId: task.sessionId,
    status: task.status,
    queuedAt: task.queuedAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    result: task.result,
    progress: cloneProgress(task.progress),
    parentModel: task.parentModel,
    model: task.model,
    fallbackChain: task.fallbackChain,
    attemptCount: task.attemptCount,
    concurrencyKey: task.concurrencyKey,
    concurrencyGroup: task.concurrencyGroup,
    parentAgent: task.parentAgent,
    parentTools: task.parentTools,
    isUnstableAgent: task.isUnstableAgent,
    error: task.error,
    category: task.category,
    retryNotification: task.retryNotification ? { ...task.retryNotification } : undefined,
    attempts: cloneAttempts(task.attempts),
    currentAttemptID: task.currentAttemptID,
    lastMsgCount: task.lastMsgCount,
    stablePolls: task.stablePolls,
    consecutiveMissedPolls: task.consecutiveMissedPolls,
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
  registry.activeTasks.set(task.id, () => cloneRegisteredTask(task))
}

export function archiveBackgroundTask(task: BackgroundTask): void {
  const registry = getRegistry()
  registry.activeTasks.delete(task.id)
  registry.completedTasks.delete(task.id)
  if (!task.sessionId || !TERMINAL_TASK_STATUSES.has(task.status)) {
    return
  }
  registry.completedTasks.set(task.id, cloneRegisteredTask(task))
  trimCompletedTasks(registry)
}

export function getRegisteredBackgroundTask(taskID: string): BackgroundTask | undefined {
  const registry = getRegistry()
  const activeTask = registry.activeTasks.get(taskID)
  if (activeTask) {
    return activeTask()
  }

  const completedTask = registry.completedTasks.get(taskID)
  return completedTask ? cloneRegisteredTask(completedTask) : undefined
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
