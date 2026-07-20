import type { PluginInput } from "@opencode-ai/plugin"
import {
  normalizeSessionId,
  isBoulderPausedForSession,
  resolveBoulderPlanPath,
} from "../../features/boulder-state"
import { log } from "../../shared/logger"
import { shouldPromptAfterSessionIdle } from "../shared/session-idle-settle"
import { HOOK_NAME } from "./hook-name"
import { handleCompletedBoulderIdle } from "./idle-completion-nudge"
import { hasRunningBackgroundTasks, injectContinuation, scheduleRetry } from "./idle-continuation"
import {
  CONTINUATION_COOLDOWN_MS,
  FAILURE_BACKOFF_MS,
  MAX_CONSECUTIVE_PROMPT_FAILURES,
} from "./idle-constants"
import { canContinueTrackedBoulderSession } from "./idle-session-eligibility"
import { resolveActiveBoulderSession } from "./resolve-active-boulder-session"
import {
  markContinuationStalled,
  resetStallStateForPlanChange,
  shouldAbortForNoToolProgress,
  updateNoToolProgressIterations,
} from "./tool-progress"
import type { AtlasHookOptions, SessionState } from "./types"

export async function handleAtlasSessionIdle(input: {
  ctx: PluginInput
  options?: AtlasHookOptions
  getState: (sessionID: string) => SessionState
  sessionID: string
}): Promise<void> {
  const { ctx, options, getState, sessionID } = input
  const normalizedSessionID = normalizeSessionId(sessionID)
  const sessionState = getState(sessionID)

  log(`[${HOOK_NAME}] session.idle`, { sessionID })

  const activeBoulderSession = await resolveActiveBoulderSession({
    client: ctx.client,
    directory: ctx.directory,
    sessionID,
  })
  if (!activeBoulderSession) {
    log(`[${HOOK_NAME}] Skipped: session not registered in active boulder`, { sessionID })
    return
  }

  const { boulderState, progress, appendedSession } = activeBoulderSession
  if (progress.isComplete) {
    await handleCompletedBoulderIdle({ ctx, options, sessionID, sessionState, boulderState })
    return
  }

  if (appendedSession) {
    log(`[${HOOK_NAME}] Appended subagent session to boulder during idle`, {
      sessionID,
      plan: boulderState.plan_name,
    })
  }

  const canContinueSession = await canContinueTrackedBoulderSession({
    client: ctx.client,
    sessionID,
    sessionOrigin: boulderState.session_origins?.[normalizedSessionID],
    boulderSessionIDs: boulderState.session_ids,
    requiredAgent: boulderState.agent,
  })
  if (!canContinueSession) {
    log(`[${HOOK_NAME}] Skipped: tracked descendant agent does not match boulder agent`, {
      sessionID,
      requiredAgent: boulderState.agent ?? "atlas",
    })
    return
  }

  const now = Date.now()
  const activePlanPath = resolveBoulderPlanPath(ctx.directory, boulderState)
  resetStallStateForPlanChange(sessionState, activePlanPath)

  if (sessionState.waitingForFinalWaveApproval || isBoulderPausedForSession(ctx.directory, {
    reason: "final_wave_approval",
    sessionId: sessionID,
  })) {
    log(`[${HOOK_NAME}] Skipped: waiting for explicit final-wave approval`, { sessionID })
    return
  }

  if (sessionState.stalledContinuationReason) {
    log(`[${HOOK_NAME}] Skipped: boulder continuation stalled`, {
      sessionID,
      reason: sessionState.stalledContinuationReason,
    })
    return
  }

  const noProgressIterations = updateNoToolProgressIterations(sessionState)
  if (shouldAbortForNoToolProgress(sessionState)) {
    markContinuationStalled(sessionState, boulderState.plan_name, activePlanPath)
    if (sessionState.pendingRetryTimer) {
      clearTimeout(sessionState.pendingRetryTimer)
      sessionState.pendingRetryTimer = undefined
    }
    log(`[${HOOK_NAME}] Aborting boulder continuation after repeated no-tool-progress iterations`, {
      sessionID,
      plan: boulderState.plan_name,
      noProgressIterations,
      reason: sessionState.stalledContinuationReason,
    })
    return
  }

  if (sessionState.lastEventWasAbortError) {
    sessionState.lastEventWasAbortError = false
    log(`[${HOOK_NAME}] Skipped: abort error immediately before idle`, { sessionID })
    return
  }

  if (sessionState.skipNextIdleAfterRuntimeErrorRetry) {
    sessionState.skipNextIdleAfterRuntimeErrorRetry = false
    log(`[${HOOK_NAME}] Skipped: stale idle after runtime error retry`, { sessionID })
    return
  }

  if (sessionState.promptFailureCount >= MAX_CONSECUTIVE_PROMPT_FAILURES) {
    const timeSinceLastFailure =
      sessionState.lastFailureAt !== undefined ? now - sessionState.lastFailureAt : Number.POSITIVE_INFINITY
    if (timeSinceLastFailure < FAILURE_BACKOFF_MS) {
      log(`[${HOOK_NAME}] Skipped: continuation in backoff after repeated failures`, {
        sessionID,
        promptFailureCount: sessionState.promptFailureCount,
        backoffRemaining: FAILURE_BACKOFF_MS - timeSinceLastFailure,
      })
      return
    }

    sessionState.promptFailureCount = 0
    sessionState.lastFailureAt = undefined
  }

  if (hasRunningBackgroundTasks(sessionID, options)) {
    scheduleRetry({ ctx, sessionID, sessionState, options })
    log(`[${HOOK_NAME}] Skipped: background tasks running`, { sessionID })
    return
  }

  if (options?.isContinuationStopped?.(sessionID)) {
    log(`[${HOOK_NAME}] Skipped: continuation stopped for session`, { sessionID })
    return
  }

  if (sessionState.lastContinuationInjectedAt && now - sessionState.lastContinuationInjectedAt < CONTINUATION_COOLDOWN_MS) {
    scheduleRetry({ ctx, sessionID, sessionState, options })
    log(`[${HOOK_NAME}] Skipped: continuation cooldown active`, {
      sessionID,
      cooldownRemaining: CONTINUATION_COOLDOWN_MS - (now - sessionState.lastContinuationInjectedAt),
      pendingRetry: !!sessionState.pendingRetryTimer,
    })
    return
  }

  if (!(await shouldPromptAfterSessionIdle(ctx.client, sessionID, options?.idleSettleMs))) {
    log(`[${HOOK_NAME}] Skipped: session became active during idle settle`, { sessionID })
    return
  }

  await injectContinuation({
    ctx,
    sessionID,
    sessionState,
    options,
    planName: boulderState.plan_name,
    progress,
    agent: boulderState.agent,
    worktreePath: boulderState.worktree_path,
    idleSettleMs: options?.idleSettleMs ?? 0,
  })
}
