import type { PluginInput } from "@opencode-ai/plugin"
import { getPlanProgress, readBoulderState } from "../../features/boulder-state"
import { getSessionAgent, subagentSessions } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { injectBoulderContinuation } from "./boulder-continuation-injector"
import { HOOK_NAME } from "./hook-name"
import { getLastAgentFromSession } from "./session-last-agent"
import type { AtlasHookOptions, SessionState } from "./types"

const CONTINUATION_COOLDOWN_MS = 5000
const FAILURE_BACKOFF_MS = 5 * 60 * 1000
const RETRY_DELAY_MS = CONTINUATION_COOLDOWN_MS + 1000

function hasRunningBackgroundTasks(sessionID: string, options?: AtlasHookOptions): boolean {
  const backgroundManager = options?.backgroundManager
  return backgroundManager
    ? backgroundManager.getTasksByParentSession(sessionID).some((task: { status: string }) => task.status === "running")
    : false
}

function shouldSkipForAgentMismatch(input: {
  isBoulderSession: boolean
  sessionAgent: string | undefined
  lastAgent: string | null
  requiredAgent: string
}): boolean {
  if (input.isBoulderSession) {
    return false
  }

  const effectiveAgent = input.sessionAgent ?? input.lastAgent ?? ""
  const lastAgentKey = getAgentConfigKey(effectiveAgent)
  const requiredAgentKey = getAgentConfigKey(input.requiredAgent)
  const lastAgentMatchesRequired = lastAgentKey === requiredAgentKey
  const allowSisyphusForAtlasBoulder = requiredAgentKey === "atlas" && lastAgentKey === "sisyphus"

  return !lastAgentMatchesRequired && !allowSisyphusForAtlasBoulder
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
    await injectBoulderContinuation({
      ctx: input.ctx,
      sessionID: input.sessionID,
      planName: input.planName,
      remaining,
      total: input.progress.total,
      agent: input.agent,
      worktreePath: input.worktreePath,
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

    if (sessionState.promptFailureCount >= 2) return

    const currentBoulder = readBoulderState(ctx.directory)
    if (!currentBoulder) return
    if (!currentBoulder.session_ids?.includes(sessionID)) return

    const currentProgress = getPlanProgress(currentBoulder.active_plan)
    if (currentProgress.isComplete) return
    if (options?.isContinuationStopped?.(sessionID)) return
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

  const boulderState = readBoulderState(ctx.directory)
  const isBoulderSession = boulderState?.session_ids?.includes(sessionID) ?? false
  const isBackgroundTaskSession = subagentSessions.has(sessionID)
  if (!isBackgroundTaskSession && !isBoulderSession) {
    log(`[${HOOK_NAME}] Skipped: not boulder or background task session`, { sessionID })
    return
  }

  const sessionState = getState(sessionID)
  const now = Date.now()

  if (sessionState.lastEventWasAbortError) {
    sessionState.lastEventWasAbortError = false
    log(`[${HOOK_NAME}] Skipped: abort error immediately before idle`, { sessionID })
    return
  }

  if (sessionState.promptFailureCount >= 2) {
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

  if (!boulderState) {
    log(`[${HOOK_NAME}] No active boulder`, { sessionID })
    return
  }

  if (options?.isContinuationStopped?.(sessionID)) {
    log(`[${HOOK_NAME}] Skipped: continuation stopped for session`, { sessionID })
    return
  }

  const sessionAgent = getSessionAgent(sessionID)
  const lastAgent = await getLastAgentFromSession(sessionID, ctx.client)
  if (
    shouldSkipForAgentMismatch({
      isBoulderSession,
      sessionAgent,
      lastAgent,
      requiredAgent: boulderState.agent ?? "atlas",
    })
  ) {
    log(`[${HOOK_NAME}] Skipped: last agent does not match boulder agent`, {
      sessionID,
      lastAgent: sessionAgent ?? lastAgent ?? "unknown",
      requiredAgent: boulderState.agent ?? "atlas",
    })
    return
  }

  const progress = getPlanProgress(boulderState.active_plan)
  if (progress.isComplete) {
    log(`[${HOOK_NAME}] Boulder complete`, { sessionID, plan: boulderState.plan_name })
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
