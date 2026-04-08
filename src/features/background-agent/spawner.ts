import type { BackgroundTask, LaunchInput, ResumeInput } from "./types"
import type { OpencodeClient, OnSubagentSessionCreated, QueueItem } from "./constants"
import { TMUX_CALLBACK_DELAY_MS } from "./constants"
import { log, getAgentToolRestrictions, promptWithModelSuggestionRetry, createInternalAgentTextPart } from "../../shared"
import { applySessionPromptParams } from "../../shared/session-prompt-params-helpers"
import { subagentSessions } from "../claude-code-session-state"
import { getTaskToastManager } from "../task-toast-manager"
import { isInsideTmux } from "../../shared/tmux"
import type { ConcurrencyManager } from "./concurrency"

export const FALLBACK_AGENT = "general"

export function isAgentNotFoundError(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : String(error)
  return (
    message.includes("Agent not found") ||
    message.includes("agent.name")
  )
}

export function buildFallbackBody(
  originalBody: Record<string, unknown>,
  fallbackAgent: string,
): Record<string, unknown> {
  return {
    ...originalBody,
    agent: fallbackAgent,
    tools: {
      task: false,
      call_omo_agent: true,
      question: false,
      ...getAgentToolRestrictions(fallbackAgent),
    },
  }
}

export interface SpawnerContext {
  client: OpencodeClient
  directory: string
  concurrencyManager: ConcurrencyManager
  tmuxEnabled: boolean
  onSubagentSessionCreated?: OnSubagentSessionCreated
  onTaskError: (task: BackgroundTask, error: Error) => void
}

export function createTask(input: LaunchInput): BackgroundTask {
  return {
    id: `bg_${crypto.randomUUID().slice(0, 8)}`,
    status: "pending",
    queuedAt: new Date(),
    description: input.description,
    prompt: input.prompt,
    agent: input.agent,
    parentSessionID: input.parentSessionID,
    parentMessageID: input.parentMessageID,
    parentModel: input.parentModel,
    parentAgent: input.parentAgent,
    model: input.model,
  }
}

export async function startTask(
  item: QueueItem,
  ctx: SpawnerContext
): Promise<void> {
  const { task, input } = item
  const { client, directory, concurrencyManager, tmuxEnabled, onSubagentSessionCreated, onTaskError } = ctx

  log("[background-agent] Starting task:", {
    taskId: task.id,
    agent: input.agent,
    model: input.model,
  })

  const concurrencyKey = input.model
    ? `${input.model.providerID}/${input.model.modelID}`
    : input.agent

  const parentSession = await client.session.get({
    path: { id: input.parentSessionID },
  }).catch((err) => {
    log(`[background-agent] Failed to get parent session: ${err}`)
    return null
  })
  const parentDirectory = parentSession?.data?.directory ?? directory
  log(`[background-agent] Parent dir: ${parentSession?.data?.directory}, using: ${parentDirectory}`)

  const createResult = await client.session.create({
    body: {
      parentID: input.parentSessionID,
      ...(input.sessionPermission ? { permission: input.sessionPermission } : {}),
    } as Record<string, unknown>,
    query: {
      directory: parentDirectory,
    },
  }).catch((error) => {
    concurrencyManager.release(concurrencyKey)
    throw error
  })

  if (createResult.error) {
    concurrencyManager.release(concurrencyKey)
    throw new Error(`Failed to create background session: ${createResult.error}`)
  }

  const sessionID = createResult.data.id
  subagentSessions.add(sessionID)

  log("[background-agent] tmux callback check", {
    hasCallback: !!onSubagentSessionCreated,
    tmuxEnabled,
    isInsideTmux: isInsideTmux(),
    sessionID,
    parentID: input.parentSessionID,
  })

  if (onSubagentSessionCreated && tmuxEnabled && isInsideTmux()) {
    log("[background-agent] Invoking tmux callback NOW", { sessionID })
    await onSubagentSessionCreated({
      sessionID,
      parentID: input.parentSessionID,
      title: input.description,
    }).catch((err) => {
      log("[background-agent] Failed to spawn tmux pane:", err)
    })
    log("[background-agent] tmux callback completed, waiting")
    await new Promise(r => setTimeout(r, TMUX_CALLBACK_DELAY_MS))
  } else {
    log("[background-agent] SKIP tmux callback - conditions not met")
  }

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
    ? {
        providerID: input.model.providerID,
        modelID: input.model.modelID,
      }
    : undefined
  const launchVariant = input.model?.variant

  applySessionPromptParams(sessionID, input.model)

  const promptBody = {
    agent: input.agent,
    ...(launchModel ? { model: launchModel } : {}),
    ...(launchVariant ? { variant: launchVariant } : {}),
    system: input.skillContent,
    tools: {
      task: false,
      call_omo_agent: true,
      question: false,
      ...getAgentToolRestrictions(input.agent),
    },
    parts: [createInternalAgentTextPart(input.prompt)],
  }

  promptWithModelSuggestionRetry(client, {
    path: { id: sessionID },
    body: promptBody,
  }).catch(async (error) => {
    if (isAgentNotFoundError(error) && input.agent !== FALLBACK_AGENT) {
      log("[background-agent] Agent not found, retrying with fallback agent", {
        original: input.agent,
        fallback: FALLBACK_AGENT,
        taskId: task.id,
      })
      try {
        await promptWithModelSuggestionRetry(client, {
          path: { id: sessionID },
          body: buildFallbackBody(promptBody, FALLBACK_AGENT),
        })
        task.agent = FALLBACK_AGENT
        return
      } catch (retryError) {
        log("[background-agent] Fallback agent also failed:", retryError)
        onTaskError(task, retryError instanceof Error ? retryError : new Error(String(retryError)))
        return
      }
    }
    log("[background-agent] promptAsync error:", error)
    onTaskError(task, error instanceof Error ? error : new Error(String(error)))
  })
}

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
    ? {
        providerID: task.model.providerID,
        modelID: task.model.modelID,
      }
    : undefined
  const resumeVariant = task.model?.variant

  applySessionPromptParams(task.sessionID, task.model)

  const resumeBody = {
    agent: task.agent,
    ...(resumeModel ? { model: resumeModel } : {}),
    ...(resumeVariant ? { variant: resumeVariant } : {}),
    tools: {
      task: false,
      call_omo_agent: true,
      question: false,
      ...getAgentToolRestrictions(task.agent),
    },
    parts: [createInternalAgentTextPart(input.prompt)],
  }

  client.session.promptAsync({
    path: { id: task.sessionID },
    body: resumeBody,
  }).catch(async (error) => {
    if (isAgentNotFoundError(error) && task.agent !== FALLBACK_AGENT) {
      log("[background-agent] Resume agent not found, retrying with fallback agent", {
        original: task.agent,
        fallback: FALLBACK_AGENT,
        taskId: task.id,
      })
      try {
        await promptWithModelSuggestionRetry(client, {
          path: { id: task.sessionID! },
          body: buildFallbackBody(resumeBody, FALLBACK_AGENT),
        })
        task.agent = FALLBACK_AGENT
        return
      } catch (retryError) {
        log("[background-agent] Resume fallback agent also failed:", retryError)
        onTaskError(task, retryError instanceof Error ? retryError : new Error(String(retryError)))
        return
      }
    }
    log("[background-agent] resume prompt error:", error)
    onTaskError(task, error instanceof Error ? error : new Error(String(error)))
  })
}
