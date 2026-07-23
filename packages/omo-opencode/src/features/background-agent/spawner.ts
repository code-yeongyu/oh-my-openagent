import { log, promptWithRetryInDirectory } from "../../shared"
import { stripAgentListSortPrefix } from "../../shared/agent-display-names"
import { applySessionPromptParams } from "../../shared/session-prompt-params-helpers"
import { setSessionTools } from "../../shared/session-tools-store"
import { setSessionAgent, subagentSessions, updateSessionAgent } from "../claude-code-session-state"
import { getTaskToastManager } from "../task-toast-manager"
import type { ConcurrencyManager } from "./concurrency"
import type { OnSubagentSessionCreated, OpencodeClient, QueueItem } from "./constants"
import type { BackgroundTask, LaunchInput, ResumeInput } from "./types"
import { buildFallbackBody, FALLBACK_AGENT, isAgentNotFoundError } from "./spawner/fallback-agent"
import { buildTaskRecord } from "./spawner/task-record"
import { buildTaskPromptBody } from "./spawner/task-prompt-body"
import { invokeTmuxSessionCreatedCallback } from "./spawner/tmux-callback-invoker"

export { buildFallbackBody, FALLBACK_AGENT, isAgentNotFoundError }

export interface SpawnerContext {
  client: OpencodeClient
  directory: string
  concurrencyManager: ConcurrencyManager
  tmuxEnabled: boolean
  onSubagentSessionCreated?: OnSubagentSessionCreated
  onTaskError: (task: BackgroundTask, error: Error) => void
}

export function createTask(input: LaunchInput): BackgroundTask {
  return buildTaskRecord(input, `bg_${crypto.randomUUID().slice(0, 8)}`, new Date())
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
    path: { id: input.parentSessionId },
    query: { directory },
  }).catch((err: unknown) => {
    log(`[background-agent] Failed to get parent session: ${err}`)
    return null
  })
  const parentDirectory = parentSession?.data?.directory ?? directory
  log(`[background-agent] Parent dir: ${parentSession?.data?.directory}, using: ${parentDirectory}`)

  const createResult = await client.session.create({
    body: {
      parentID: input.parentSessionId,
      ...(input.sessionPermission ? { permission: input.sessionPermission } : {}),
    } as Record<string, unknown>,
    query: {
      directory: parentDirectory,
    },
  }).catch((error: unknown) => {
    concurrencyManager.release(concurrencyKey)
    throw error
  })

  if (createResult.error) {
    concurrencyManager.release(concurrencyKey)
    throw new Error(`Failed to create background session: ${createResult.error}`)
  }

  const sessionID = createResult.data.id
  const normalizedAgent = stripAgentListSortPrefix(input.agent)
  await input.onSessionCreated?.(sessionID)
  subagentSessions.add(sessionID)
  setSessionAgent(sessionID, normalizedAgent)

  task.status = "running"
  task.startedAt = new Date()
  task.sessionId = sessionID
  task.progress = {
    toolCalls: 0,
    lastUpdate: new Date(),
  }
  task.concurrencyKey = concurrencyKey
  task.concurrencyGroup = concurrencyKey

  log("[background-agent] Launching task:", { taskId: task.id, sessionID, agent: normalizedAgent })

  const toastManager = getTaskToastManager()
  if (toastManager) {
    toastManager.updateTask(task.id, "running")
  }

  log("[background-agent] Calling prompt (fire-and-forget) for launch with:", {
    sessionID,
    agent: normalizedAgent,
    model: input.model,
    hasSkillContent: !!input.skillContent,
    promptLength: input.prompt.length,
  })

  applySessionPromptParams(sessionID, input.model)

  const promptBody = buildTaskPromptBody({
    kind: "launch",
    agent: normalizedAgent,
    system: input.skillContent,
    model: input.model,
    prompt: input.prompt,
    includeTeamToolDenylist: input.teamRunId === undefined,
    teamSessionRole: input.teamSessionRole,
  })
  setSessionTools(sessionID, promptBody.tools)

  // Must fire BEFORE tmux callback: attach client needs session activity to render TUI.
  const promptChain = promptWithRetryInDirectory(client, {
    path: { id: sessionID },
    body: promptBody,
  }, parentDirectory).catch(async (error) => {
    if (isAgentNotFoundError(error) && input.agent !== FALLBACK_AGENT) {
      log("[background-agent] Agent not found, retrying with fallback agent", {
        original: input.agent,
        fallback: FALLBACK_AGENT,
        taskId: task.id,
      })
      try {
        const fallbackBody = buildFallbackBody(promptBody, FALLBACK_AGENT, {
          includeTeamToolDenylist: input.teamRunId === undefined,
          teamSessionRole: input.teamSessionRole,
        })
        const fallbackTools = fallbackBody.tools as Record<string, boolean>
        setSessionTools(sessionID, fallbackTools)
        updateSessionAgent(sessionID, FALLBACK_AGENT)
        await promptWithRetryInDirectory(client, {
          path: { id: sessionID },
          body: fallbackBody,
        }, parentDirectory)
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

  void promptChain

  invokeTmuxSessionCreatedCallback({
    callback: onSubagentSessionCreated,
    tmuxEnabled,
    suppress: false,
    sessionID,
    parentID: input.parentSessionId,
    title: input.description,
    log,
  })
}

export async function resumeTask(
  task: BackgroundTask,
  input: ResumeInput,
  ctx: Pick<SpawnerContext, "client" | "concurrencyManager" | "directory" | "onTaskError">
): Promise<void> {
  const { client, concurrencyManager, directory, onTaskError } = ctx

  if (!task.sessionId) {
    throw new Error(`Task has no sessionID: ${task.id}`)
  }
  const sessionID = task.sessionId

  if (task.status === "running") {
    throw new Error(
      `Task ${task.id} is currently running and cannot accept a continuation prompt. ` +
      "Wait for it to complete before resuming it with task_id.",
    )
  }

  const concurrencyKey = task.concurrencyGroup ?? task.agent
  await concurrencyManager.acquire(concurrencyKey)
  task.concurrencyKey = concurrencyKey
  task.concurrencyGroup = concurrencyKey

  task.status = "running"
  task.completedAt = undefined
  task.error = undefined
  task.parentSessionId = input.parentSessionId
  task.parentMessageId = input.parentMessageId
  task.parentModel = input.parentModel
  task.parentAgent = input.parentAgent
  task.startedAt = new Date()

  task.progress = {
    toolCalls: task.progress?.toolCalls ?? 0,
    lastUpdate: new Date(),
  }

  subagentSessions.add(sessionID)

  const toastManager = getTaskToastManager()
  if (toastManager) {
    toastManager.addTask({
      id: task.id,
      description: task.description,
      agent: task.agent,
      isBackground: true,
    })
  }

  log("[background-agent] Resuming task:", { taskId: task.id, sessionID })

  log("[background-agent] Resuming task - calling prompt (fire-and-forget) with:", {
    sessionID,
    agent: task.agent,
    model: task.model,
    promptLength: input.prompt.length,
  })

  applySessionPromptParams(sessionID, task.model)

  const resumeBody = buildTaskPromptBody({
    kind: "resume",
    agent: task.agent,
    model: task.model,
    prompt: input.prompt,
    includeTeamToolDenylist: task.teamRunId === undefined,
    teamSessionRole: task.teamSessionRole,
  })
  setSessionTools(sessionID, resumeBody.tools)

  promptWithRetryInDirectory(client, {
    path: { id: sessionID },
    body: resumeBody,
  }, directory).catch(async (error) => {
    if (isAgentNotFoundError(error) && task.agent !== FALLBACK_AGENT) {
      log("[background-agent] Resume agent not found, retrying with fallback agent", {
        original: task.agent,
        fallback: FALLBACK_AGENT,
        taskId: task.id,
      })
      try {
        const fallbackBody = buildFallbackBody(resumeBody, FALLBACK_AGENT, {
          includeTeamToolDenylist: task.teamRunId === undefined,
          teamSessionRole: task.teamSessionRole,
        })
        const fallbackTools = fallbackBody.tools as Record<string, boolean>
        setSessionTools(sessionID, fallbackTools)
        updateSessionAgent(sessionID, FALLBACK_AGENT)
        await promptWithRetryInDirectory(client, {
          path: { id: sessionID },
          body: fallbackBody,
        }, directory)
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
