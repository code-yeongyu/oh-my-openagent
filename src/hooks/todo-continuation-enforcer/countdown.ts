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
}): void {
  const {
    ctx,
    sessionID,
    incompleteCount,
    resolvedInfo,
    backgroundManager,
    skipAgents,
    sessionStateStore,
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

  state.countdownTimer = setTimeout(() => {
    sessionStateStore.cancelCountdown(sessionID)
    injectContinuation({
      ctx,
      sessionID,
      backgroundManager,
      skipAgents,
      resolvedInfo,
      sessionStateStore,
    })
  }, COUNTDOWN_SECONDS * 1000)

  log(`[${HOOK_NAME}] Countdown started`, {
    sessionID,
    seconds: COUNTDOWN_SECONDS,
    incompleteCount,
  })
}
