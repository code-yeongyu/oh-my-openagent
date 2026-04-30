import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { normalizeSDKResponse } from "../../shared"
import { log } from "../../shared/logger"
import { getAgentConfigKey } from "../../shared/agent-display-names"

import { ABORT_WINDOW_MS, CONTINUATION_COOLDOWN_MS, CLARIFICATION_COOLDOWN_MS, CLARIFICATION_BLOCKED_PROMPT, CLARIFICATION_ESCALATION_PROMPT, DEFAULT_SKIP_AGENTS, FAILURE_RESET_WINDOW_MS, HOOK_NAME, IN_FLIGHT_TIMEOUT_MS, MAX_CONSECUTIVE_FAILURES, MAX_CLARIFICATION_CONSECUTIVE } from "./constants"
import { isLastAssistantMessageAborted } from "./abort-detection"
import { detectClarificationSeeking } from "./clarification-detection"
import { hasUnansweredQuestion } from "./pending-question-detection"
import { shouldStopForStagnation } from "./stagnation-detection"
import { getIncompleteCount } from "./todo"
import type { MessageInfo, MessageWithInfo, ResolvedMessageInfo, Todo } from "./types"
import { resolveLatestMessageInfo } from "./resolve-message-info"
import { acknowledgeCompactionGuard, isCompactionGuardActive } from "./compaction-guard"
import type { SessionStateStore } from "./session-state"
import { startCountdown } from "./countdown"
import { injectContinuation } from "./continuation-injection"
import { persistLoopState } from "./loop-state-persistence"

function shouldAllowActivityProgress(modelID: string | undefined): boolean {
  if (!modelID) {
    return false
  }

  return !modelID.toLowerCase().includes("codex")
}

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
  const observedCompactionEpoch = state.recentCompactionEpoch
  if (state.isRecovering) {
    log(`[${HOOK_NAME}] Skipped: in recovery`, { sessionID })
    return
  }

  if (state.wasCancelled) {
    log(`[${HOOK_NAME}] Skipped: session was cancelled`, { sessionID })
    return
  }

  if (state.tokenLimitDetected) {
    log(`[${HOOK_NAME}] Skipped: token limit error detected, retry would worsen context overflow`, { sessionID })
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

  let prefetchedMessages: MessageWithInfo[] | undefined
  try {
    const messagesResp = await ctx.client.session.messages({
      path: { id: sessionID },
      query: { directory: ctx.directory },
    })
    prefetchedMessages = normalizeSDKResponse(messagesResp, [] as MessageWithInfo[])
    if (isLastAssistantMessageAborted(prefetchedMessages)) {
      log(`[${HOOK_NAME}] Skipped: last assistant message was aborted (API fallback)`, { sessionID })
      return
    }
    if (hasUnansweredQuestion(prefetchedMessages)) {
      log(`[${HOOK_NAME}] Skipped: pending question awaiting user response`, { sessionID })
      return
    }

    const clarificationResult = detectClarificationSeeking(prefetchedMessages)
    if (clarificationResult.isAskingForClarification) {
      const now = Date.now()
      if (state.lastClarificationDetectedAt && now - state.lastClarificationDetectedAt < CLARIFICATION_COOLDOWN_MS) {
        log(`[${HOOK_NAME}] Skipped: clarification cooldown active`, { sessionID })
        return
      }

      state.consecutiveClarifications += 1
      state.lastClarificationDetectedAt = now
      persistLoopState(ctx.directory, sessionID, {
        consecutiveClarifications: state.consecutiveClarifications,
        consecutiveFailures: state.consecutiveFailures,
        stagnationCount: state.stagnationCount,
      })
      log(`[${HOOK_NAME}] Clarification-seeking detected`, {
        sessionID,
        consecutiveClarifications: state.consecutiveClarifications,
      })
    } else {
      state.consecutiveClarifications = 0
      state.lastClarificationDetectedAt = undefined
      persistLoopState(ctx.directory, sessionID, {
        consecutiveClarifications: 0,
        consecutiveFailures: state.consecutiveFailures,
        stagnationCount: state.stagnationCount,
      })
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
    sessionStateStore.resetContinuationProgress(sessionID)
    log(`[${HOOK_NAME}] No todos`, { sessionID })
    return
  }

  const incompleteCount = getIncompleteCount(todos)
  if (incompleteCount === 0) {
    sessionStateStore.resetContinuationProgress(sessionID)
    log(`[${HOOK_NAME}] All todos complete`, { sessionID, total: todos.length })
    return
  }

  if (state.inFlight) {
    if (state.inFlightSince && Date.now() - state.inFlightSince > IN_FLIGHT_TIMEOUT_MS) {
      state.inFlight = false
      state.inFlightSince = undefined
      log(`[${HOOK_NAME}] Reset stuck inFlight flag (timeout after ${IN_FLIGHT_TIMEOUT_MS}ms)`, { sessionID })
    } else {
      log(`[${HOOK_NAME}] Skipped: injection in flight`, { sessionID })
      return
    }
  }

  // BLOCKED escalation must fire before consecutiveFailures check.
  // Even if regular continuation is failing (API errors, rate limits),
  // the BLOCKED prompt is a one-way instruction that must be delivered.
  if (state.consecutiveClarifications >= MAX_CLARIFICATION_CONSECUTIVE) {
    log(`[${HOOK_NAME}] BLOCKED: injecting stop prompt (${state.consecutiveClarifications} consecutive clarifications)`, { sessionID })
    void injectContinuation({
      ctx,
      sessionID,
      backgroundManager,
      skipAgents,
      sessionStateStore,
      isContinuationStopped,
      promptOverride: CLARIFICATION_BLOCKED_PROMPT,
    })
    return
  }

  if (
    state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
    && state.lastInjectedAt
    && Date.now() - state.lastInjectedAt >= FAILURE_RESET_WINDOW_MS
  ) {
    state.consecutiveFailures = 0
    log(`[${HOOK_NAME}] Reset consecutive failures after recovery window`, { sessionID, failureResetWindowMs: FAILURE_RESET_WINDOW_MS })
  }

  if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    log(`[${HOOK_NAME}] Skipped: max consecutive failures reached`, { sessionID, consecutiveFailures: state.consecutiveFailures })
    return
  }

  const effectiveCooldown =
    CONTINUATION_COOLDOWN_MS * Math.pow(2, Math.min(state.consecutiveFailures, 5))
  if (state.lastInjectedAt && Date.now() - state.lastInjectedAt < effectiveCooldown) {
    log(`[${HOOK_NAME}] Skipped: cooldown active`, { sessionID, effectiveCooldown, consecutiveFailures: state.consecutiveFailures })
    return
  }

  let resolvedInfo: ResolvedMessageInfo | undefined
  let encounteredCompaction = false
  let latestMessageWasCompaction = false
  try {
    const messageInfoResult = await resolveLatestMessageInfo(ctx, sessionID, prefetchedMessages)
    resolvedInfo = messageInfoResult.resolvedInfo
    encounteredCompaction = messageInfoResult.encounteredCompaction
    latestMessageWasCompaction = messageInfoResult.latestMessageWasCompaction
  } catch (error) {
    log(`[${HOOK_NAME}] Failed to fetch messages for agent check`, { sessionID, error: String(error) })
  }

  if (latestMessageWasCompaction) {
    log(`[${HOOK_NAME}] Skipped: latest message is a compaction marker`, { sessionID })
    return
  }

  const sessionAgent = getSessionAgent(sessionID)
  if (!resolvedInfo?.agent && sessionAgent) {
    resolvedInfo = { ...resolvedInfo, agent: sessionAgent }
  }

  const acknowledgedCompaction = resolvedInfo?.agent ? acknowledgeCompactionGuard(state, observedCompactionEpoch) : false
  const compactionGuardActive = isCompactionGuardActive(state, Date.now())

  log(`[${HOOK_NAME}] Agent check`, {
    sessionID,
    agentName: resolvedInfo?.agent,
    skipAgents,
    compactionGuardActive,
    observedCompactionEpoch,
    currentCompactionEpoch: state.recentCompactionEpoch,
    acknowledgedCompaction,
  })

  const resolvedAgentName = resolvedInfo?.agent
  if (resolvedAgentName && skipAgents.some(s => getAgentConfigKey(s) === getAgentConfigKey(resolvedAgentName))) {
    log(`[${HOOK_NAME}] Skipped: agent in skipAgents list`, { sessionID, agent: resolvedAgentName })
    return
  }
  if ((compactionGuardActive || encounteredCompaction) && !resolvedInfo?.agent) {
    log(`[${HOOK_NAME}] Skipped: compaction occurred but no agent info resolved`, { sessionID })
    return
  }
  if (compactionGuardActive) {
    log(`[${HOOK_NAME}] Skipped: compaction guard still armed for current epoch`, { sessionID, observedCompactionEpoch, currentCompactionEpoch: state.recentCompactionEpoch })
    return
  }

  if (isContinuationStopped?.(sessionID)) {
    log(`[${HOOK_NAME}] Skipped: continuation stopped for session`, { sessionID })
    return
  }

  let promptOverride: string | undefined
  if (state.consecutiveClarifications >= MAX_CLARIFICATION_CONSECUTIVE - 1) {
    promptOverride = CLARIFICATION_ESCALATION_PROMPT
    log(`[${HOOK_NAME}] Escalating: warning prompt for clarification tier 2`, { sessionID })
  }

  const progressUpdate = sessionStateStore.trackContinuationProgress(
    sessionID,
    incompleteCount,
    todos,
    { allowActivityProgress: shouldAllowActivityProgress(resolvedInfo?.model?.modelID) },
  )
  if (shouldStopForStagnation({ sessionID, incompleteCount, progressUpdate })) {
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
    isContinuationStopped,
    promptOverride,
  })
}
