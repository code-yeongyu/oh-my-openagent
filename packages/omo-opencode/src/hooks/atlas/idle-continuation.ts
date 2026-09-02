import type { PluginInput } from "@opencode-ai/plugin"
import {
  getPlanProgress,
  getTaskSessionState,
  normalizeSessionId,
  readBoulderState,
  readCurrentTopLevelTask,
  resolveBoulderPlanPath,
} from "../../features/boulder-state"
import { normalizeSDKResponse } from "../../shared"
import { log } from "../../shared/logger"
import { isCompactionMessage } from "../../shared/compaction-marker"
import { isLastAssistantMessageAborted } from "../todo-continuation-enforcer"
import type { MessageWithInfo } from "../todo-continuation-enforcer"
import { injectBoulderContinuation } from "./boulder-continuation-injector"
import { HOOK_NAME } from "./hook-name"
import {
  CONTINUATION_COOLDOWN_MS,
  MAX_CONSECUTIVE_PROMPT_FAILURES,
  RETRY_DELAY_MS,
} from "./idle-constants"
import { canContinueTrackedBoulderSession } from "./idle-session-eligibility"
import type { AtlasHookOptions, SessionState } from "./types"

const ACTIVE_BACKGROUND_TASK_STATUSES = new Set(["pending", "running"])

function isErroredCompactionMarker(message: MessageWithInfo): boolean {
  return isCompactionMessage(message) && message.info?.error != null
}

async function shouldSkipInjectionForLatestTurnState(input: {
  ctx: PluginInput
  sessionID: string
}): Promise<boolean> {
  let messages: MessageWithInfo[]
  try {
    const messagesResp = await input.ctx.client.session.messages({
      path: { id: input.sessionID },
      query: { directory: input.ctx.directory },
    })
    messages = normalizeSDKResponse(messagesResp, [] as MessageWithInfo[])
  } catch (error) {
    const loggedError = error instanceof Error ? { name: error.name, message: error.message } : String(error)
    log(`[${HOOK_NAME}] Latest message state unavailable, continuing without turn-state guard`, {
      sessionID: input.sessionID,
      error: loggedError,
    })
    return false
  }

  if (isLastAssistantMessageAborted(messages)) {
    log(`[${HOOK_NAME}] Skipped injection: last assistant message was aborted`, { sessionID: input.sessionID })
    return true
  }
  const latestMessage = messages[messages.length - 1]
  if (latestMessage && isErroredCompactionMarker(latestMessage)) {
    log(`[${HOOK_NAME}] Skipped injection: latest message is an errored compaction marker`, { sessionID: input.sessionID })
    return true
  }
  return false
}

export function hasRunningBackgroundTasks(sessionID: string, options?: AtlasHookOptions): boolean {
  const backgroundManager = options?.backgroundManager
  return backgroundManager
    ? backgroundManager
        .getTasksByParentSession(sessionID)
        .some((task: { status: string }) => ACTIVE_BACKGROUND_TASK_STATUSES.has(task.status))
    : false
}

export async function injectContinuation(input: {
  ctx: PluginInput
  sessionID: string
  sessionState: SessionState
  options?: AtlasHookOptions
  planName: string
  progress: { total: number; completed: number }
  agent?: string
  worktreePath?: string
  idleSettleMs?: number
}): Promise<void> {
  if (input.sessionState.lifecycleActive === false) return
  const remaining = input.progress.total - input.progress.completed
  if (input.sessionState.isInjectingContinuation) {
    scheduleRetry({
      ctx: input.ctx,
      sessionID: input.sessionID,
      sessionState: input.sessionState,
      options: input.options,
    })
    return
  }

  input.sessionState.isInjectingContinuation = true

  try {
    const currentBoulder = readBoulderState(input.ctx.directory)
    const normalizedSessionID = normalizeSessionId(input.sessionID)
    const currentPlanPath = currentBoulder
      ? resolveBoulderPlanPath(input.ctx.directory, currentBoulder)
      : null
    const currentTask = currentBoulder
      && currentPlanPath
      ? readCurrentTopLevelTask(currentPlanPath)
      : null
    const preferredTaskSession = currentTask
      ? getTaskSessionState(input.ctx.directory, currentTask.key)
      : null

    if (!currentBoulder) {
      return
    }

    const canContinueSession = await canContinueTrackedBoulderSession({
      client: input.ctx.client,
      sessionID: input.sessionID,
      sessionOrigin: currentBoulder.session_origins?.[normalizedSessionID],
      boulderSessionIDs: currentBoulder.session_ids,
      requiredAgent: currentBoulder.agent,
    })
    if (!canContinueSession) {
      log(`[${HOOK_NAME}] Skipped: tracked descendant agent does not match boulder agent`, {
        sessionID: input.sessionID,
        requiredAgent: currentBoulder.agent ?? "atlas",
      })
      return
    }

    if (await shouldSkipInjectionForLatestTurnState({ ctx: input.ctx, sessionID: input.sessionID })) {
      return
    }

    const result = await injectBoulderContinuation({
      ctx: input.ctx,
      sessionID: input.sessionID,
      planName: input.planName,
      remaining,
      total: input.progress.total,
      agent: input.agent,
      worktreePath: input.worktreePath,
      preferredTaskSessionId: preferredTaskSession?.session_id,
      preferredTaskTitle: preferredTaskSession?.task_title,
      backgroundManager: input.options?.backgroundManager,
      sessionState: input.sessionState,
      idleSettleMs: input.idleSettleMs,
    })

    if (result === "injected") {
      if (input.sessionState.pendingRetryTimer) {
        clearTimeout(input.sessionState.pendingRetryTimer)
        input.sessionState.pendingRetryTimer = undefined
      }
      input.sessionState.lastContinuationInjectedAt = Date.now()
      return
    }

    if (result === "skipped_background_tasks") {
      scheduleRetry({
        ctx: input.ctx,
        sessionID: input.sessionID,
        sessionState: input.sessionState,
        options: input.options,
      })
      return
    }

    if (result === "skipped_active_session") {
      scheduleRetry({
        ctx: input.ctx,
        sessionID: input.sessionID,
        sessionState: input.sessionState,
        options: input.options,
      })
      return
    }

    if (result === "failed") {
      scheduleRetry({
        ctx: input.ctx,
        sessionID: input.sessionID,
        sessionState: input.sessionState,
        options: input.options,
      })
    }
  } catch (error) {
    const loggedError = error instanceof Error ? error : String(error)
    log(`[${HOOK_NAME}] Failed to inject boulder continuation`, { sessionID: input.sessionID, error: loggedError })
    input.sessionState.promptFailureCount += 1
    input.sessionState.lastFailureAt = Date.now()
    scheduleRetry({
      ctx: input.ctx,
      sessionID: input.sessionID,
      sessionState: input.sessionState,
      options: input.options,
    })
  } finally {
    input.sessionState.isInjectingContinuation = false
  }
}

export function scheduleRetry(input: {
  ctx: PluginInput
  sessionID: string
  sessionState: SessionState
  options?: AtlasHookOptions
}): void {
  const { ctx, sessionID, sessionState, options } = input
  if (sessionState.lifecycleActive === false) return
  if (sessionState.pendingRetryTimer) {
    return
  }

  sessionState.pendingRetryTimer = setTimeout(async () => {
    try {
      sessionState.pendingRetryTimer = undefined

      if (sessionState.lifecycleActive === false) return

      if (sessionState.promptFailureCount >= MAX_CONSECUTIVE_PROMPT_FAILURES) return
      if (sessionState.stalledContinuationReason) return
      if (sessionState.tokenLimitDetected) return
      if (sessionState.unrecoverableErrorDetected) return
      if (sessionState.waitingForFinalWaveApproval) return

      const now = Date.now()
      if (
        sessionState.lastContinuationInjectedAt
        && now - sessionState.lastContinuationInjectedAt < CONTINUATION_COOLDOWN_MS
      ) {
        return
      }

      const currentBoulder = readBoulderState(ctx.directory)
      if (!currentBoulder) return
      const normalizedSessionID = normalizeSessionId(sessionID)
      if (!currentBoulder.session_ids?.includes(normalizedSessionID)) return

      const currentProgress = getPlanProgress(resolveBoulderPlanPath(ctx.directory, currentBoulder))
      if (currentProgress.isComplete) return
      if (options?.isContinuationStopped?.(sessionID)) return
      const canContinueSession = await canContinueTrackedBoulderSession({
        client: ctx.client,
        sessionID,
        sessionOrigin: currentBoulder.session_origins?.[normalizedSessionID],
        boulderSessionIDs: currentBoulder.session_ids,
        requiredAgent: currentBoulder.agent,
      })
      if (!canContinueSession) return
      if (hasRunningBackgroundTasks(sessionID, options)) {
        scheduleRetry({ ctx, sessionID, sessionState, options })
        return
      }

      await injectContinuation({
        ctx,
        sessionID,
        sessionState,
        options,
        planName: currentBoulder.plan_name,
        progress: currentProgress,
        agent: currentBoulder.agent,
        worktreePath: currentBoulder.worktree_path,
      })
    } catch (error) {
      const loggedError = error instanceof Error ? error : String(error)
      log(`[${HOOK_NAME}] Failed during boulder continuation retry`, { sessionID, error: loggedError })
      sessionState.promptFailureCount += 1
      sessionState.lastFailureAt = Date.now()
      scheduleRetry({ ctx, sessionID, sessionState, options })
    }
  }, RETRY_DELAY_MS)
}
