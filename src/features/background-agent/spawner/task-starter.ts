import type { QueueItem } from "../constants"
import { log, getAgentToolRestrictions, promptWithModelSuggestionRetry } from "../../../shared"
import { subagentSessions } from "../../claude-code-session-state"
import { getTaskToastManager } from "../../task-toast-manager"
import { createBackgroundSession } from "./background-session-creator"
import { getConcurrencyKeyFromLaunchInput } from "./concurrency-key-from-launch-input"
import { resolveParentDirectory } from "./parent-directory-resolver"
import type { SpawnerContext } from "./spawner-context"
import { maybeInvokeTmuxCallback } from "./tmux-callback-invoker"

export async function startTask(item: QueueItem, ctx: SpawnerContext): Promise<void> {
  const { task, input } = item
  const { client, directory, concurrencyManager, tmuxEnabled, onSubagentSessionCreated, onTaskError } = ctx

  log("[background-agent] Starting task:", {
    taskId: task.id,
    agent: input.agent,
    model: input.model,
  })

  const concurrencyKey = getConcurrencyKeyFromLaunchInput(input)
  const parentDirectory = await resolveParentDirectory({
    client,
    parentSessionID: input.parentSessionID,
    defaultDirectory: directory,
  })

  const sessionID = await createBackgroundSession({
    client,
    input,
    parentDirectory,
    concurrencyManager,
    concurrencyKey,
  })
  subagentSessions.add(sessionID)

  await maybeInvokeTmuxCallback({
    onSubagentSessionCreated,
    tmuxEnabled,
    sessionID,
    parentID: input.parentSessionID,
    title: input.description,
  })

  task.status = "running"
  task.startedAt = new Date()
  task.sessionID = sessionID
  task.progress = {
    toolCalls: 0,
    lastUpdate: new Date(),
  }
  task.concurrencyKey = concurrencyKey
  task.concurrencyGroup = concurrencyKey

  log("[background-agent] Launching task:", { taskId: task.id, sessionID, agent: input.agent })

  const toastManager = getTaskToastManager()
  if (toastManager) {
    toastManager.updateTask(task.id, "running")
  }

  log("[background-agent] Calling prompt (fire-and-forget) for launch with:", {
    sessionID,
    agent: input.agent,
    model: input.model,
    hasSkillContent: !!input.skillContent,
    promptLength: input.prompt.length,
  })

  const launchModel = input.model
    ? { providerID: input.model.providerID, modelID: input.model.modelID }
    : undefined
  const launchVariant = input.model?.variant

  promptWithModelSuggestionRetry(client, {
    path: { id: sessionID },
    body: {
      agent: input.agent,
      ...(launchModel ? { model: launchModel } : {}),
      ...(launchVariant ? { variant: launchVariant } : {}),
      system: input.skillContent,
      tools: {
        ...getAgentToolRestrictions(input.agent),
        task: false,
        call_omo_agent: true,
        question: false,
      },
      parts: [{ type: "text", text: input.prompt }],
    },
  }).catch((error: unknown) => {
    log("[background-agent] promptAsync error:", error)
    onTaskError(task, error instanceof Error ? error : new Error(String(error)))
  })
}
