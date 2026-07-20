import type { PluginInput } from "@opencode-ai/plugin"

import type { BackgroundManager } from "../../features/background-agent"
import { isBoulderPausedForSession } from "../../features/boulder-state"
import {
  getSessionAgent,
  handedBackSyncSessions,
  resolveRegisteredAgentName,
} from "../../features/claude-code-session-state"
import {
  createInternalAgentContinuationTextPart,
  isAmbiguousPostDispatchPromptFailure,
  normalizeSDKResponse,
  resolveInheritedPromptTools,
} from "../../shared"
import {
  findNearestMessageWithFields,
  findNearestMessageWithFieldsFromSDK,
  type ToolPermission,
} from "../../features/hook-message-injector"
import { log } from "../../shared/logger"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import {
  getAgentConfigKey,
  normalizeAgentForPrompt,
} from "../../shared/agent-display-names"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../shared/prompt-async-gate"

import {
  CONTINUATION_PROMPT,
  CONTINUATION_COOLDOWN_MS,
  DEFAULT_SKIP_AGENTS,
  HOOK_NAME,
} from "./constants"
import { isCompactionGuardActive } from "./compaction-guard"
import { getMessageDir } from "./message-directory"
import { isTokenLimitError } from "./token-limit-detection"
import { getIncompleteCount } from "./todo"
import type { ResolvedMessageInfo, Todo } from "./types"
import type { SessionStateStore } from "./session-state"

function hasWritePermission(tools: Record<string, ToolPermission> | undefined): boolean {
  const editPermission = tools?.edit
  const writePermission = tools?.write
  return (
    !tools ||
    (editPermission !== false && editPermission !== "deny" && writePermission !== false && writePermission !== "deny")
  )
}

export async function injectContinuation(args: {
  ctx: PluginInput
  sessionID: string
  backgroundManager?: BackgroundManager
  skipAgents?: string[]
  resolvedInfo?: ResolvedMessageInfo
  sessionStateStore: SessionStateStore
  isContinuationStopped?: (sessionID: string) => boolean
}): Promise<void> {
  const {
    ctx,
    sessionID,
    backgroundManager,
    skipAgents = DEFAULT_SKIP_AGENTS,
    resolvedInfo,
    sessionStateStore,
    isContinuationStopped,
  } = args

  const state = sessionStateStore.getExistingState(sessionID)
  if (state?.isRecovering) {
    log(`[${HOOK_NAME}] Skipped injection: in recovery`, { sessionID })
    return
  }

  if (state?.wasCancelled) {
    log(`[${HOOK_NAME}] Skipped injection: session was cancelled`, { sessionID })
    return
  }

  if (handedBackSyncSessions.has(sessionID)) {
    log(`[${HOOK_NAME}] Skipped injection: sync subagent already handed back to parent`, { sessionID })
    return
  }

  if (isContinuationStopped?.(sessionID)) {
    log(`[${HOOK_NAME}] Skipped injection: continuation stopped for session`, { sessionID })
    return
  }

  if (isBoulderPausedForSession(ctx.directory, {
    reason: "final_wave_approval",
    sessionId: sessionID,
  })) {
    log(`[${HOOK_NAME}] Skipped injection: boulder waiting for explicit final-wave approval`, { sessionID })
    return
  }

  const hasRunningBgTasks = backgroundManager
    ? backgroundManager.getTasksByParentSession(sessionID).some((task: { status: string }) => task.status === "running" || task.status === "pending")
      || backgroundManager.hasPendingParentWake?.(sessionID) === true
    : false

  if (hasRunningBgTasks) {
    log(`[${HOOK_NAME}] Skipped injection: background tasks running`, { sessionID })
    return
  }

  let todos: Todo[] = []
  try {
    const response = await ctx.client.session.todo({ path: { id: sessionID } })
    todos = normalizeSDKResponse(response, [] as Todo[], { preferResponseOnMissingData: true })
  } catch (error) {
    const loggedError = error instanceof Error ? error : String(error)
    log(`[${HOOK_NAME}] Failed to fetch todos`, { sessionID, error: loggedError })
    return
  }

  const freshIncompleteCount = getIncompleteCount(todos)
  if (freshIncompleteCount === 0) {
    log(`[${HOOK_NAME}] Skipped injection: no incomplete todos`, { sessionID })
    return
  }

  let agentName = resolvedInfo?.agent ?? getSessionAgent(sessionID)
  let model = resolvedInfo?.model
  let tools = resolvedInfo?.tools

  if (!agentName || !model) {
    let previousMessage = null
    if (isSqliteBackend()) {
      previousMessage = await findNearestMessageWithFieldsFromSDK(ctx.client, sessionID)
    } else {
      const messageDir = getMessageDir(sessionID)
      previousMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
    }
    agentName = agentName ?? previousMessage?.agent
    model =
      model ??
      (previousMessage?.model?.providerID && previousMessage?.model?.modelID
        ? {
            providerID: previousMessage.model.providerID,
            modelID: previousMessage.model.modelID,
            ...(previousMessage.model.variant
              ? { variant: previousMessage.model.variant }
              : {}),
          }
        : undefined)
    tools = tools ?? previousMessage?.tools
  }

  const agentConfigKey = getAgentConfigKey(agentName ?? "")
  const registeredAgentName = resolveRegisteredAgentName(agentName)
  const promptAgent = registeredAgentName !== undefined && registeredAgentName !== agentConfigKey
    ? registeredAgentName
    : normalizeAgentForPrompt(agentName)

  if (promptAgent && skipAgents.some(s => getAgentConfigKey(s) === getAgentConfigKey(promptAgent))) {
    log(`[${HOOK_NAME}] Skipped: agent in skipAgents list`, { sessionID, agent: agentName })
    return
  }

  if (!promptAgent) {
    const compactionState = sessionStateStore.getExistingState(sessionID)
    if (compactionState && isCompactionGuardActive(compactionState, Date.now())) {
      log(`[${HOOK_NAME}] Skipped: agent unknown after compaction`, { sessionID })
      return
    }
  }

  if (!hasWritePermission(tools)) {
    log(`[${HOOK_NAME}] Skipped: agent lacks write permission`, { sessionID, agent: agentName })
    return
  }

  const incompleteTodos = todos.filter((todo) => todo.status !== "completed" && todo.status !== "cancelled")
  const todoList = incompleteTodos.map((todo) => `- [${todo.status}] ${todo.content}`).join("\n")
  const prompt = `${CONTINUATION_PROMPT}

[Status: ${todos.length - freshIncompleteCount}/${todos.length} completed, ${freshIncompleteCount} remaining]

Remaining tasks:
${todoList}`

  const hasBackgroundWorkBeforeDispatch = backgroundManager
    ? backgroundManager.getTasksByParentSession(sessionID).some((task: { status: string }) => task.status === "running" || task.status === "pending")
      || backgroundManager.hasPendingParentWake?.(sessionID) === true
    : false

  if (hasBackgroundWorkBeforeDispatch) {
    log(`[${HOOK_NAME}] Skipped injection: background tasks running before prompt`, { sessionID })
    return
  }

  const injectionState = sessionStateStore.getExistingState(sessionID)
  if (injectionState?.wasCancelled) {
    log(`[${HOOK_NAME}] Skipped injection: session was cancelled before prompt`, { sessionID })
    return
  }

  if (injectionState?.continuationBlockReason) {
    log(`[${HOOK_NAME}] Skipped injection: continuation paused at turn boundary`, {
      sessionID,
      reason: injectionState.continuationBlockReason,
    })
    return
  }

  if (injectionState) {
    injectionState.inFlight = true
  }

  try {
    log(`[${HOOK_NAME}] Injecting continuation`, {
      sessionID,
      agent: promptAgent,
      model,
      incompleteCount: freshIncompleteCount,
    })

    const inheritedTools = resolveInheritedPromptTools(sessionID, tools)

    const launchModel = model
      ? { providerID: model.providerID, modelID: model.modelID }
      : undefined
    const launchVariant = model?.variant

    const promptResult = await dispatchInternalPrompt({
      mode: "async",
      client: ctx.client,
      sessionID,
      source: HOOK_NAME,
      settleMs: 0,
      queueBehavior: "defer",
      semanticDedupeHoldMs: CONTINUATION_COOLDOWN_MS,
      input: {
        path: { id: sessionID },
        body: {
          agent: promptAgent,
          ...(launchModel ? { model: launchModel } : {}),
          ...(launchVariant ? { variant: launchVariant } : {}),
          ...(inheritedTools ? { tools: inheritedTools } : {}),
          parts: [createInternalAgentContinuationTextPart(prompt)],
        },
        query: { directory: ctx.directory },
      },
    })
    if (promptResult.status === "failed") {
      if (isAmbiguousPostDispatchPromptFailure(promptResult)) {
        if (injectionState) {
          injectionState.inFlight = false
          injectionState.lastInjectedAt = Date.now()
          injectionState.awaitingPostInjectionProgressCheck = true
          injectionState.continuationResponseObserved = false
          injectionState.continuationBlockReason = undefined
          injectionState.pendingUserMessageID = undefined
          injectionState.consecutiveFailures = 0
        }
        return
      }
      throw promptResult.error
    }
    if (!isInternalPromptDispatchAccepted(promptResult)) {
      log(`[${HOOK_NAME}] Injection skipped by promptAsync gate`, { sessionID, status: promptResult.status })
      if (injectionState) {
        injectionState.inFlight = false
      }
      return
    }

    log(`[${HOOK_NAME}] Injection successful`, { sessionID, status: promptResult.status })
    if (injectionState) {
      injectionState.inFlight = false
      injectionState.lastInjectedAt = Date.now()
      injectionState.awaitingPostInjectionProgressCheck = true
      injectionState.continuationResponseObserved = false
      injectionState.continuationBlockReason = undefined
      injectionState.pendingUserMessageID = undefined
      injectionState.consecutiveFailures = 0
    }
  } catch (error) {
    log(`[${HOOK_NAME}] Injection failed`, { sessionID, error: String(error) })
    if (injectionState) {
      injectionState.inFlight = false
      injectionState.lastInjectedAt = Date.now()
      injectionState.consecutiveFailures = (injectionState.consecutiveFailures ?? 0) + 1

      const errorObj = error instanceof Error
        ? { name: error.name, message: error.message }
        : { message: String(error) }
      if (isTokenLimitError(errorObj)) {
        injectionState.tokenLimitDetected = true
        log(`[${HOOK_NAME}] Token limit error detected during injection, stopping continuation`, { sessionID })
      }
    }
  }
}
