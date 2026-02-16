import type { PluginInput } from "@opencode-ai/plugin"

import type { BackgroundManager } from "../../features/background-agent"
import type { ToolPermission } from "../../features/hook-message-injector"
import { normalizeSDKResponse } from "../../shared"
import { log } from "../../shared/logger"
import { getAgentConfigKey } from "../../shared/agent-display-names"

import {
  ABORT_WINDOW_MS,
  CONTINUATION_COOLDOWN_MS,
  DEFAULT_SKIP_AGENTS,
  FAILURE_RESET_WINDOW_MS,
  HOOK_NAME,
  MAX_CONSECUTIVE_FAILURES,
} from "./constants"
import { isLastAssistantMessageAborted } from "./abort-detection"
import { getIncompleteCount } from "./todo"
import type { MessageInfo, ResolvedMessageInfo, Todo } from "./types"
import type { SessionStateStore } from "./session-state"
import { startCountdown } from "./countdown"

export async function handleSessionIdle(args: {
  ctx: PluginInput
  sessionID: string
  sessionStateStore: SessionStateStore
  backgroundManager?: BackgroundManager
  skipAgents?: string[]
  isContinuationStopped?: (sessionID: string) => boolean
}): Promise<void> {
  const {
    ctx,
    sessionID,
    sessionStateStore,
    backgroundManager,
    skipAgents = DEFAULT_SKIP_AGENTS,
    isContinuationStopped,
  } = args

  log(`[${HOOK_NAME}] session.idle`, { sessionID })

  const state = sessionStateStore.getState(sessionID)
  if (state.isRecovering) {
    log(`[${HOOK_NAME}] Skipped: in recovery`, { sessionID })
    return
  }

  if (state.abortDetectedAt) {
    const timeSinceAbort = Date.now() - state.abortDetectedAt
    if (timeSinceAbort < ABORT_WINDOW_MS) {
      log(`[${HOOK_NAME}] Skipped: abort detected via event ${timeSinceAbort}ms ago`, { sessionID })
      state.abortDetectedAt = undefined
      return
    }
    state.abortDetectedAt = undefined
  }

  const hasRunningBgTasks = backgroundManager
    ? backgroundManager.getTasksByParentSession(sessionID).some((task: { status: string }) => task.status === "running")
    : false

  if (hasRunningBgTasks) {
    log(`[${HOOK_NAME}] Skipped: background tasks running`, { sessionID })
    return
  }

  try {
    const messagesResp = await ctx.client.session.messages({
      path: { id: sessionID },
      query: { directory: ctx.directory },
    })
    const messages = normalizeSDKResponse(messagesResp, [] as Array<{ info?: MessageInfo }>)
    if (isLastAssistantMessageAborted(messages)) {
      log(`[${HOOK_NAME}] Skipped: last assistant message was aborted (API fallback)`, { sessionID })
      return
    }
  } catch (error) {
    log(`[${HOOK_NAME}] Messages fetch failed, continuing`, { sessionID, error: String(error) })
  }

  let todos: Todo[] = []
  try {
    const response = await ctx.client.session.todo({ path: { id: sessionID } })
    todos = normalizeSDKResponse(response, [] as Todo[], { preferResponseOnMissingData: true })
  } catch (error) {
    log(`[${HOOK_NAME}] Todo fetch failed`, { sessionID, error: String(error) })
    return
  }

  if (!todos || todos.length === 0) {
    log(`[${HOOK_NAME}] No todos`, { sessionID })
    return
  }

  const incompleteCount = getIncompleteCount(todos)
  if (incompleteCount === 0) {
    log(`[${HOOK_NAME}] All todos complete`, { sessionID, total: todos.length })
    return
  }

  if (state.inFlight) {
    log(`[${HOOK_NAME}] Skipped: injection in flight`, { sessionID })
    return
  }

  if (
    state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
    && state.lastInjectedAt
    && Date.now() - state.lastInjectedAt >= FAILURE_RESET_WINDOW_MS
  ) {
    state.consecutiveFailures = 0
    log(`[${HOOK_NAME}] Reset consecutive failures after recovery window`, {
      sessionID,
      failureResetWindowMs: FAILURE_RESET_WINDOW_MS,
    })
  }

  if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    log(`[${HOOK_NAME}] Skipped: max consecutive failures reached`, {
      sessionID,
      consecutiveFailures: state.consecutiveFailures,
      maxConsecutiveFailures: MAX_CONSECUTIVE_FAILURES,
    })
    return
  }

  const effectiveCooldown =
    CONTINUATION_COOLDOWN_MS * Math.pow(2, Math.min(state.consecutiveFailures, 5))
  if (state.lastInjectedAt && Date.now() - state.lastInjectedAt < effectiveCooldown) {
    log(`[${HOOK_NAME}] Skipped: cooldown active`, {
      sessionID,
      effectiveCooldown,
      consecutiveFailures: state.consecutiveFailures,
    })
    return
  }

  let resolvedInfo: ResolvedMessageInfo | undefined
  let hasCompactionMessage = false
  try {
    const messagesResp = await ctx.client.session.messages({
      path: { id: sessionID },
    })
    const messages = normalizeSDKResponse(messagesResp, [] as Array<{ info?: MessageInfo }>)
    for (let i = messages.length - 1; i >= 0; i--) {
      const info = messages[i].info
      if (info?.agent === "compaction") {
        hasCompactionMessage = true
        continue
      }
      if (info?.agent || info?.model || (info?.modelID && info?.providerID)) {
        resolvedInfo = {
          agent: info.agent,
          model: info.model ?? (info.providerID && info.modelID ? { providerID: info.providerID, modelID: info.modelID } : undefined),
          tools: info.tools as Record<string, ToolPermission> | undefined,
        }
        break
      }
    }
  } catch (error) {
    log(`[${HOOK_NAME}] Failed to fetch messages for agent check`, { sessionID, error: String(error) })
  }

  log(`[${HOOK_NAME}] Agent check`, { sessionID, agentName: resolvedInfo?.agent, skipAgents, hasCompactionMessage })

  const resolvedAgentName = resolvedInfo?.agent
  if (resolvedAgentName && skipAgents.some(s => getAgentConfigKey(s) === getAgentConfigKey(resolvedAgentName))) {
    log(`[${HOOK_NAME}] Skipped: agent in skipAgents list`, { sessionID, agent: resolvedAgentName })
    return
  }
  if (hasCompactionMessage && !resolvedInfo?.agent) {
    log(`[${HOOK_NAME}] Skipped: compaction occurred but no agent info resolved`, { sessionID })
    return
  }

  if (isContinuationStopped?.(sessionID)) {
    log(`[${HOOK_NAME}] Skipped: continuation stopped for session`, { sessionID })
    return
  }

  startCountdown({
    ctx,
    sessionID,
    incompleteCount,
    total: todos.length,
    resolvedInfo,
    backgroundManager,
    skipAgents,
    sessionStateStore,
  })
}
