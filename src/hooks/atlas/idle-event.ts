import type { PluginInput } from "@opencode-ai/plugin"
import {
  getPlanProgress,
  getTaskSessionState,
  readBoulderState,
  readCurrentTopLevelTask,
} from "../../features/boulder-state"
import { log } from "../../shared/logger"
import { injectBoulderContinuation } from "./boulder-continuation-injector"
import { HOOK_NAME } from "./hook-name"
import { resolveActiveBoulderSession } from "./resolve-active-boulder-session"
import type { AtlasHookOptions, SessionState } from "./types"

const CONTINUATION_COOLDOWN_MS = 5000
const FAILURE_BACKOFF_MS = 5 * 60 * 1000
const MAX_CONSECUTIVE_PROMPT_FAILURES = 10
const RETRY_DELAY_MS = CONTINUATION_COOLDOWN_MS + 1000

function hasRunningBackgroundTasks(sessionID: string, options?: AtlasHookOptions): boolean {
  const backgroundManager = options?.backgroundManager
  return backgroundManager
    ? backgroundManager.getTasksByParentSession(sessionID).some((task: { status: string }) => task.status === "running")
    : false
}

async function injectContinuation(input: {
  ctx: PluginInput
  sessionID: string
  sessionState: SessionState
  options?: AtlasHookOptions
  planName: string
  progress: { total: number; completed: number }
  agent?: string
  worktreePath?: string
}): Promise<void> {
  const remaining = input.progress.total - input.progress.completed
  input.sessionState.lastContinuationInjectedAt = Date.now()

  try {
    const currentBoulder = readBoulderState(input.ctx.directory)
    const currentTask = currentBoulder
      ? readCurrentTopLevelTask(currentBoulder.active_plan)
      : null
    const preferredTaskSession = currentTask
      ? getTaskSessionState(input.ctx.directory, currentTask.key)
      : null

    await injectBoulderContinuation({
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
    })
  } catch (error) {
    log(`[${HOOK_NAME}] Failed to inject boulder continuation`, { sessionID: input.sessionID, error })
    input.sessionState.promptFailureCount += 1
  }
}

function scheduleRetry(input: {
  ctx: PluginInput
  sessionID: string
  sessionState: SessionState
  options?: AtlasHookOptions
}): void {
  const { ctx, sessionID, sessionState, options } = input
  if (sessionState.pendingRetryTimer) {
    return
  }

  sessionState.pendingRetryTimer = setTimeout(async () => {
    sessionState.pendingRetryTimer = undefined

    if (sessionState.promptFailureCount >= MAX_CONSECUTIVE_PROMPT_FAILURES) return
    if (sessionState.waitingForFinalWaveApproval) return

    const currentBoulder = readBoulderState(ctx.directory)
    if (!currentBoulder) return
    if (!currentBoulder.session_ids?.includes(sessionID)) return

    const currentProgress = getPlanProgress(currentBoulder.active_plan)
    if (currentProgress.isComplete) return
    if (options?.isContinuationStopped?.(sessionID)) return
    if (options?.shouldSkipContinuation?.(sessionID)) return
    if (hasRunningBackgroundTasks(sessionID, options)) return

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
  }, RETRY_DELAY_MS)
}

export async function handleAtlasSessionIdle(input: {
  ctx: PluginInput
  options?: AtlasHookOptions
  getState: (sessionID: string) => SessionState
  sessionID: string
}): Promise<void> {
  const { ctx, options, getState, sessionID } = input

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
    log(`[${HOOK_NAME}] Boulder complete`, { sessionID, plan: boulderState.plan_name })
    return
  }

  if (appendedSession) {
    log(`[${HOOK_NAME}] Appended subagent session to boulder during idle`, {
      sessionID,
      plan: boulderState.plan_name,
    })
  }

  const sessionState = getState(sessionID)
  const now = Date.now()

  if (sessionState.waitingForFinalWaveApproval) {
    log(`[${HOOK_NAME}] Skipped: waiting for explicit final-wave approval`, { sessionID })
    return
  }

  if (sessionState.lastEventWasAbortError) {
    sessionState.lastEventWasAbortError = false
    log(`[${HOOK_NAME}] Skipped: abort error immediately before idle`, { sessionID })
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
    log(`[${HOOK_NAME}] Skipped: background tasks running`, { sessionID })
    return
  }

  if (options?.isContinuationStopped?.(sessionID)) {
    log(`[${HOOK_NAME}] Skipped: continuation stopped for session`, { sessionID })
    return
  }

  if (options?.shouldSkipContinuation?.(sessionID)) {
    log(`[${HOOK_NAME}] Skipped: another continuation hook already injected`, { sessionID })
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

  await injectContinuation({
    ctx,
    sessionID,
    sessionState,
    options,
    planName: boulderState.plan_name,
    progress,
    agent: boulderState.agent,
    worktreePath: boulderState.worktree_path,
  })
}
