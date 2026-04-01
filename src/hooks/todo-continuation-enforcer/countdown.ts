import type { PluginInput } from "@opencode-ai/plugin"

import type { BackgroundManager } from "../../features/background-agent"
import { log } from "../../shared/logger"

import {
  COUNTDOWN_SECONDS,
  HOOK_NAME,
  TOAST_DURATION_MS,
} from "./constants"
import type { ResolvedMessageInfo } from "./types"
import type { SessionStateStore } from "./session-state"
import { injectContinuation } from "./continuation-injection"

async function showCountdownToast(
  ctx: PluginInput,
  seconds: number,
  incompleteCount: number
): Promise<void> {
  await ctx.client.tui
    .showToast({
      body: {
        title: "Todo Continuation",
        message: `Resuming in ${seconds}s... (${incompleteCount} tasks remaining)`,
        variant: "warning" as const,
        duration: TOAST_DURATION_MS,
      },
    })
    .catch(() => {})
}

export function startCountdown(args: {
  ctx: PluginInput
  sessionID: string
  incompleteCount: number
  total: number
  resolvedInfo?: ResolvedMessageInfo
  backgroundManager?: BackgroundManager
  skipAgents: string[]
  sessionStateStore: SessionStateStore
  isContinuationStopped?: (sessionID: string) => boolean
}): void {
  const {
    ctx,
    sessionID,
    incompleteCount,
    resolvedInfo,
    backgroundManager,
    skipAgents,
    sessionStateStore,
    isContinuationStopped,
  } = args

  const state = sessionStateStore.getState(sessionID)
  sessionStateStore.cancelCountdown(sessionID)

  let secondsRemaining = COUNTDOWN_SECONDS
  showCountdownToast(ctx, secondsRemaining, incompleteCount)
  state.countdownStartedAt = Date.now()

  state.countdownInterval = setInterval(() => {
    secondsRemaining--
    if (secondsRemaining > 0) {
      showCountdownToast(ctx, secondsRemaining, incompleteCount)
    }
  }, 1000)

  state.countdownTimer = setTimeout(async () => {
    sessionStateStore.cancelCountdown(sessionID)

    try {
      const statusRes = await ctx.client.session.status()
      const allStatuses = (statusRes as any).data || statusRes || {}
      const currentStatus = allStatuses[sessionID]
      
      if (currentStatus && currentStatus.type !== "idle") {
        log(`[${HOOK_NAME}] Session is not idle (status: ${currentStatus.type}), cancelling continuation`, { sessionID })
        return
      }
    } catch (e) {
      log(`[${HOOK_NAME}] Failed to check session status, proceeding anyway`, { sessionID, error: String(e) })
    }

    injectContinuation({
      ctx,
      sessionID,
      backgroundManager,
      skipAgents,
      resolvedInfo,
      sessionStateStore,
      isContinuationStopped,
    })
  }, COUNTDOWN_SECONDS * 1000)

  log(`[${HOOK_NAME}] Countdown started`, {
    sessionID,
    seconds: COUNTDOWN_SECONDS,
    incompleteCount,
  })
}
