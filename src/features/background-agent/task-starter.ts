import { log, getAgentToolRestrictions, promptWithModelSuggestionRetry } from "../../shared"
import { isInsideTmux } from "../../shared/tmux"

import { subagentSessions } from "../claude-code-session-state"
import { getTaskToastManager } from "../task-toast-manager"

import type { BackgroundTask } from "./types"
import type { LaunchInput } from "./types"
import type { ConcurrencyManager } from "./concurrency"
import type { OpencodeClient } from "./opencode-client"

type QueueItem = {
  task: BackgroundTask
  input: LaunchInput
}

type ModelRef = { providerID: string; modelID: string }

export async function startQueuedTask(args: {
  item: QueueItem
  client: OpencodeClient
  defaultDirectory: string
  tmuxEnabled: boolean
  onSubagentSessionCreated?: (event: { sessionID: string; parentID: string; title: string }) => Promise<void>
  startPolling: () => void
  getConcurrencyKeyFromInput: (input: LaunchInput) => string
  concurrencyManager: ConcurrencyManager
  findBySession: (sessionID: string) => BackgroundTask | undefined
  markForNotification: (task: BackgroundTask) => void
  cleanupPendingByParent: (task: BackgroundTask) => void
  notifyParentSession: (task: BackgroundTask) => Promise<void>
}): Promise<void> {
  const {
    item,
    client,
    defaultDirectory,
    tmuxEnabled,
    onSubagentSessionCreated,
    startPolling,
    getConcurrencyKeyFromInput,
    concurrencyManager,
    findBySession,
    markForNotification,
    cleanupPendingByParent,
    notifyParentSession,
  } = args

  const { task, input } = item

  log("[background-agent] Starting task:", {
    taskId: task.id,
    agent: input.agent,
    model: input.model,
  })

  const concurrencyKey = getConcurrencyKeyFromInput(input)

  const parentSession = await client.session.get({
    path: { id: input.parentSessionID },
  }).catch((err) => {
    log(`[background-agent] Failed to get parent session: ${err}`)
    return null
  })

  const parentDirectory = parentSession?.data?.directory ?? defaultDirectory
  log(`[background-agent] Parent dir: ${parentSession?.data?.directory}, using: ${parentDirectory}`)

  const createResult = await client.session.create({
    body: {
      parentID: input.parentSessionID,
      title: `${input.description} (@${input.agent} subagent)`,
    } as any,
    query: {
      directory: parentDirectory,
    },
  })

  if (createResult.error) {
    throw new Error(`Failed to create background session: ${createResult.error}`)
  }

  if (!createResult.data?.id) {
    throw new Error("Failed to create background session: API returned no session ID")
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
    log("[background-agent] tmux callback completed, waiting 200ms")
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 200)
    })
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

  startPolling()

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

  const launchModel: ModelRef | undefined = input.model
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
  }).catch((error) => {
    log("[background-agent] promptAsync error:", error)
    const existingTask = findBySession(sessionID)
    if (!existingTask) return

    existingTask.status = "interrupt"
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (errorMessage.includes("agent.name") || errorMessage.includes("undefined")) {
      existingTask.error = `Agent "${input.agent}" not found. Make sure the agent is registered in your opencode.json or provided by a plugin.`
    } else {
      existingTask.error = errorMessage
    }
    existingTask.completedAt = new Date()

    if (existingTask.concurrencyKey) {
      concurrencyManager.release(existingTask.concurrencyKey)
      existingTask.concurrencyKey = undefined
    }

    client.session.abort({
      path: { id: sessionID },
    }).catch(() => {})

    markForNotification(existingTask)
    cleanupPendingByParent(existingTask)
    notifyParentSession(existingTask).catch((err) => {
      log("[background-agent] Failed to notify on error:", err)
    })
  })
}
