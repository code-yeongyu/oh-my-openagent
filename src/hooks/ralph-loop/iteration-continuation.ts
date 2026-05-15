import type { PluginInput } from "@opencode-ai/plugin"
import type { RalphLoopState } from "./types"
import { log } from "../../shared/logger"
import { HOOK_NAME } from "./constants"
import { buildContinuationPrompt } from "./continuation-prompt-builder"
import { injectContinuationPrompt } from "./continuation-prompt-injector"
import { createIterationSession, selectSessionInTui } from "./session-reset-strategy"

type ContinuationOptions = {
  directory: string
  apiTimeoutMs: number
  idleSettleMs: number
  previousSessionID: string
  loopState: {
    setSessionID: (sessionID: string) => RalphLoopState | null
  }
}

export type ContinuationResult =
  | { status: "dispatched"; sessionID: string }
  | { status: "session_creation_rejected" }
  | { status: "dispatch_rejected"; error: unknown }

export async function continueIteration(
  ctx: PluginInput,
  state: RalphLoopState,
  options: ContinuationOptions,
): Promise<ContinuationResult> {
  const strategy = state.strategy ?? "continue"
  const continuationPrompt = buildContinuationPrompt(state)

  if (strategy === "reset") {
    const newSessionID = await createIterationSession(
      ctx,
      options.previousSessionID,
      options.directory,
    )
    if (!newSessionID) {
      return { status: "session_creation_rejected" }
    }

    try {
      const promptResult = await injectContinuationPrompt(ctx, {
        sessionID: newSessionID,
        inheritFromSessionID: options.previousSessionID,
        prompt: continuationPrompt,
        directory: options.directory,
        apiTimeoutMs: options.apiTimeoutMs,
        idleSettleMs: options.idleSettleMs,
      })
      if (promptResult.status === "rejected") {
        return { status: "dispatch_rejected", error: promptResult.error }
      }
    } catch (error: unknown) {
      return { status: "dispatch_rejected", error }
    }

    await selectSessionInTui(ctx.client, newSessionID)

    const boundState = options.loopState.setSessionID(newSessionID)
    if (!boundState) {
      log(`[${HOOK_NAME}] Failed to bind loop state to new session`, {
        previousSessionID: options.previousSessionID,
        newSessionID,
      })
      return { status: "dispatch_rejected", error: "state commit failed after reset dispatch" }
    }

    return { status: "dispatched", sessionID: newSessionID }
  }

  try {
    const promptResult = await injectContinuationPrompt(ctx, {
      sessionID: options.previousSessionID,
      prompt: continuationPrompt,
      directory: options.directory,
      apiTimeoutMs: options.apiTimeoutMs,
      idleSettleMs: options.idleSettleMs,
    })
    if (promptResult.status === "rejected") {
      return { status: "dispatch_rejected", error: promptResult.error }
    }
  } catch (error: unknown) {
    return { status: "dispatch_rejected", error }
  }

  return { status: "dispatched", sessionID: options.previousSessionID }
}
