import { log, getAgentToolRestrictions } from "../../shared"
import { subagentSessions } from "../claude-code-session-state"
import { getTaskToastManager } from "../task-toast-manager"

import type { BackgroundTask, ResumeInput } from "./types"
import type { ConcurrencyManager } from "./concurrency"
import type { OpencodeClient } from "./opencode-client"

type ModelRef = { providerID: string; modelID: string }

export async function resumeBackgroundTask(args: {
  input: ResumeInput
  findBySession: (sessionID: string) => BackgroundTask | undefined
  client: OpencodeClient
  concurrencyManager: ConcurrencyManager
  pendingByParent: Map<string, Set<string>>
  startPolling: () => void
  markForNotification: (task: BackgroundTask) => void
  cleanupPendingByParent: (task: BackgroundTask) => void
  notifyParentSession: (task: BackgroundTask) => Promise<void>
}): Promise<BackgroundTask> {
  const {
    input,
    findBySession,
    client,
    concurrencyManager,
    pendingByParent,
    startPolling,
    markForNotification,
    cleanupPendingByParent,
    notifyParentSession,
  } = args

  const existingTask = findBySession(input.sessionId)
  if (!existingTask) {
    throw new Error(`Task not found for session: ${input.sessionId}`)
  }

  if (!existingTask.sessionID) {
    throw new Error(`Task has no sessionID: ${existingTask.id}`)
  }

  if (existingTask.status === "running") {
    log("[background-agent] Resume skipped - task already running:", {
      taskId: existingTask.id,
      sessionID: existingTask.sessionID,
    })
    return existingTask
  }

  const concurrencyKey =
    existingTask.concurrencyGroup ??
    (existingTask.model
      ? `${existingTask.model.providerID}/${existingTask.model.modelID}`
      : existingTask.agent)
  await concurrencyManager.acquire(concurrencyKey)
  existingTask.concurrencyKey = concurrencyKey
  existingTask.concurrencyGroup = concurrencyKey

  existingTask.status = "running"
  existingTask.completedAt = undefined
  existingTask.error = undefined
  existingTask.parentSessionID = input.parentSessionID
  existingTask.parentMessageID = input.parentMessageID
  existingTask.parentModel = input.parentModel
  existingTask.parentAgent = input.parentAgent
  existingTask.startedAt = new Date()

  existingTask.progress = {
    toolCalls: existingTask.progress?.toolCalls ?? 0,
    lastUpdate: new Date(),
  }

  startPolling()
  if (existingTask.sessionID) {
    subagentSessions.add(existingTask.sessionID)
  }

  if (input.parentSessionID) {
    const pending = pendingByParent.get(input.parentSessionID) ?? new Set<string>()
    pending.add(existingTask.id)
    pendingByParent.set(input.parentSessionID, pending)
  }

  const toastManager = getTaskToastManager()
  if (toastManager) {
    toastManager.addTask({
      id: existingTask.id,
      description: existingTask.description,
      agent: existingTask.agent,
      isBackground: true,
    })
  }

  log("[background-agent] Resuming task:", { taskId: existingTask.id, sessionID: existingTask.sessionID })
  log("[background-agent] Resuming task - calling prompt (fire-and-forget) with:", {
    sessionID: existingTask.sessionID,
    agent: existingTask.agent,
    model: existingTask.model,
    promptLength: input.prompt.length,
  })

  const resumeModel: ModelRef | undefined = existingTask.model
    ? { providerID: existingTask.model.providerID, modelID: existingTask.model.modelID }
    : undefined
  const resumeVariant = existingTask.model?.variant

  client.session.promptAsync({
    path: { id: existingTask.sessionID },
    body: {
      agent: existingTask.agent,
      ...(resumeModel ? { model: resumeModel } : {}),
      ...(resumeVariant ? { variant: resumeVariant } : {}),
      tools: {
        ...getAgentToolRestrictions(existingTask.agent),
        task: false,
        call_omo_agent: true,
        question: false,
      },
      parts: [{ type: "text", text: input.prompt }],
    },
  }).catch((error) => {
    log("[background-agent] resume prompt error:", error)
    existingTask.status = "interrupt"
    const errorMessage = error instanceof Error ? error.message : String(error)
    existingTask.error = errorMessage
    existingTask.completedAt = new Date()

    if (existingTask.concurrencyKey) {
      concurrencyManager.release(existingTask.concurrencyKey)
      existingTask.concurrencyKey = undefined
    }

    if (existingTask.sessionID) {
      client.session.abort({
        path: { id: existingTask.sessionID },
      }).catch(() => {})
    }

    markForNotification(existingTask)
    cleanupPendingByParent(existingTask)
    notifyParentSession(existingTask).catch((err) => {
      log("[background-agent] Failed to notify on resume error:", err)
    })
  })

  return existingTask
}
