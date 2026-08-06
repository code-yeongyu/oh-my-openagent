import type { DelegatedModelConfig } from "../../shared/model-resolution-types"
import type { BackgroundTask, BackgroundTaskAttempt, BackgroundTaskStatus } from "./types"

type TerminalAttemptStatus = Extract<BackgroundTaskStatus, "completed" | "error" | "cancelled" | "interrupt">

function toAttemptModel(model: DelegatedModelConfig | undefined): Pick<BackgroundTaskAttempt, "providerId" | "modelId" | "variant"> {
  return {
    providerId: model?.providerID,
    modelId: model?.modelID,
    variant: model?.variant,
  }
}

function toTaskModel(attempt: BackgroundTaskAttempt): DelegatedModelConfig | undefined {
  if (!attempt.providerId || !attempt.modelId) {
    return undefined
  }

  return {
    providerID: attempt.providerId,
    modelID: attempt.modelId,
    ...(attempt.variant ? { variant: attempt.variant } : {}),
  }
}

function getAttemptIndex(task: BackgroundTask, attemptID: string): number {
  return task.attempts?.findIndex((attempt) => attempt.attemptId === attemptID) ?? -1
}

function getAttempt(task: BackgroundTask, attemptID: string): BackgroundTaskAttempt | undefined {
  const index = getAttemptIndex(task, attemptID)
  return index === -1 ? undefined : task.attempts?.[index]
}

function isTerminalStatus(status: BackgroundTaskStatus): status is TerminalAttemptStatus {
  return status === "completed" || status === "error" || status === "cancelled" || status === "interrupt"
}

export function getCurrentAttempt(task: BackgroundTask): BackgroundTaskAttempt | undefined {
  if (!task.currentAttemptID) {
    return undefined
  }

  return getAttempt(task, task.currentAttemptID)
}

export function ensureCurrentAttempt(
  task: BackgroundTask,
  model: DelegatedModelConfig | undefined = task.model,
): BackgroundTaskAttempt {
  const existingAttempt = getCurrentAttempt(task)
  if (existingAttempt) {
    return existingAttempt
  }

  const attempt: BackgroundTaskAttempt = {
    attemptId: `att_${crypto.randomUUID().slice(0, 8)}`,
    attemptNumber: (task.attempts?.length ?? 0) + 1,
    sessionId: task.sessionId,
    ...toAttemptModel(model),
    status: task.status,
    error: task.error,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
  }

  task.attempts = [...(task.attempts ?? []), attempt]
  task.currentAttemptID = attempt.attemptId
  return attempt
}

export function projectTaskFromCurrentAttempt(task: BackgroundTask): BackgroundTask {
  const currentAttempt = getCurrentAttempt(task)
  if (!currentAttempt) {
    return task
  }

  task.status = currentAttempt.status
  task.sessionId = currentAttempt.sessionId
  task.startedAt = currentAttempt.startedAt
  task.completedAt = currentAttempt.completedAt
  task.error = currentAttempt.error
  task.model = toTaskModel(currentAttempt)

  return task
}

export function startAttempt(task: BackgroundTask, model: DelegatedModelConfig | undefined): BackgroundTaskAttempt {
  const attempt: BackgroundTaskAttempt = {
    attemptId: `att_${crypto.randomUUID().slice(0, 8)}`,
    attemptNumber: (task.attempts?.length ?? 0) + 1,
    ...toAttemptModel(model),
    status: "pending",
  }

  task.attempts = [...(task.attempts ?? []), attempt]
  task.currentAttemptID = attempt.attemptId
  task.status = "pending"
  task.sessionId = undefined
  task.startedAt = undefined
  task.completedAt = undefined
  task.error = undefined
  task.model = model

  return attempt
}

export function bindAttemptSession(
  task: BackgroundTask,
  attemptID: string,
  sessionID: string,
  model: DelegatedModelConfig | undefined,
): BackgroundTaskAttempt | undefined {
  ensureCurrentAttempt(task, model)
  if (task.currentAttemptID !== attemptID) {
    return undefined
  }

  const attempt = getAttempt(task, attemptID)
  if (!attempt || isTerminalStatus(attempt.status)) {
    return undefined
  }

  attempt.sessionId = sessionID
  attempt.status = "running"
  attempt.startedAt = new Date()
  attempt.completedAt = undefined
  attempt.error = undefined
  attempt.providerId = model?.providerID ?? attempt.providerId
  attempt.modelId = model?.modelID ?? attempt.modelId
  attempt.variant = model?.variant ?? attempt.variant

  return getCurrentAttempt(projectTaskFromCurrentAttempt(task))
}

export function finalizeAttempt(
  task: BackgroundTask,
  attemptID: string,
  status: TerminalAttemptStatus,
  error?: string,
): BackgroundTaskAttempt | undefined {
  const attempt = getAttempt(task, attemptID)
  if (!attempt) {
    return undefined
  }

  attempt.status = status
  attempt.completedAt = new Date()
  attempt.error = error

  if (task.currentAttemptID === attemptID) {
    projectTaskFromCurrentAttempt(task)
  }

  return attempt
}

export function scheduleRetryAttempt(
  task: BackgroundTask,
  failedAttemptID: string,
  nextModel: DelegatedModelConfig,
  error?: string,
): BackgroundTaskAttempt | undefined {
  const failedAttempt = finalizeAttempt(task, failedAttemptID, "error", error)
  if (!failedAttempt || task.currentAttemptID !== failedAttemptID) {
    return undefined
  }

  return startAttempt(task, nextModel)
}

export function findAttemptBySession(task: BackgroundTask, sessionID: string): BackgroundTaskAttempt | undefined {
  return task.attempts?.find((attempt) => attempt.sessionId === sessionID)
}
