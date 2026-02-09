import type { BackgroundTask, ResumeInput } from "../types"
import { log, getAgentToolRestrictions } from "../../../shared"
import type { SpawnerContext } from "./spawner-context"
import { subagentSessions } from "../../claude-code-session-state"
import { getTaskToastManager } from "../../task-toast-manager"

export async function resumeTask(
  task: BackgroundTask,
  input: ResumeInput,
  ctx: Pick<SpawnerContext, "client" | "concurrencyManager" | "onTaskError">
): Promise<void> {
  const { client, concurrencyManager, onTaskError } = ctx

  if (!task.sessionID) {
    throw new Error(`Task has no sessionID: ${task.id}`)
  }

  if (task.status === "running") {
    log("[background-agent] Resume skipped - task already running:", {
      taskId: task.id,
      sessionID: task.sessionID,
    })
    return
  }

  const concurrencyKey = task.concurrencyGroup ?? task.agent
  await concurrencyManager.acquire(concurrencyKey)
  task.concurrencyKey = concurrencyKey
  task.concurrencyGroup = concurrencyKey

  task.status = "running"
  task.completedAt = undefined
  task.error = undefined
  task.parentSessionID = input.parentSessionID
  task.parentMessageID = input.parentMessageID
  task.parentModel = input.parentModel
  task.parentAgent = input.parentAgent
  task.startedAt = new Date()

  task.progress = {
    toolCalls: task.progress?.toolCalls ?? 0,
    lastUpdate: new Date(),
  }

  subagentSessions.add(task.sessionID)

  const toastManager = getTaskToastManager()
  if (toastManager) {
    toastManager.addTask({
      id: task.id,
      description: task.description,
      agent: task.agent,
      isBackground: true,
    })
  }

  log("[background-agent] Resuming task:", { taskId: task.id, sessionID: task.sessionID })

  log("[background-agent] Resuming task - calling prompt (fire-and-forget) with:", {
    sessionID: task.sessionID,
    agent: task.agent,
    model: task.model,
    promptLength: input.prompt.length,
  })

  const resumeModel = task.model
    ? { providerID: task.model.providerID, modelID: task.model.modelID }
    : undefined
  const resumeVariant = task.model?.variant

  client.session
    .promptAsync({
      path: { id: task.sessionID },
      body: {
        agent: task.agent,
        ...(resumeModel ? { model: resumeModel } : {}),
        ...(resumeVariant ? { variant: resumeVariant } : {}),
        tools: {
          ...getAgentToolRestrictions(task.agent),
          task: false,
          call_omo_agent: true,
          question: false,
        },
        parts: [{ type: "text", text: input.prompt }],
      },
    })
    .catch((error: unknown) => {
      log("[background-agent] resume prompt error:", error)
      onTaskError(task, error instanceof Error ? error : new Error(String(error)))
    })
}
