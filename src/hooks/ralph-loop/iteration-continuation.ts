import type { PluginInput } from "@opencode-ai/plugin"
import type { RalphLoopState } from "./types"
import { log } from "../../shared/logger"
import { HOOK_NAME } from "./constants"
import { buildContinuationPrompt } from "./continuation-prompt-builder"
import { buildResetIterationPrompt } from "./reset-iteration-prompt-builder"
import { injectContinuationPrompt } from "./continuation-prompt-injector"
import { createIterationSession, selectSessionInTui } from "./session-reset-strategy"
import { updateIterationSessionTitle } from "./iteration-session-title"

type ContinuationOptions = {
  directory: string
  apiTimeoutMs: number
  previousSessionID: string
  loopState: {
    setSessionID: (sessionID: string) => RalphLoopState | null
  }
}

export async function continueIteration(
  ctx: PluginInput,
  state: RalphLoopState,
  options: ContinuationOptions,
): Promise<void> {
  const strategy = state.strategy ?? "continue"

  if (strategy === "reset") {
    const resetPrompt = buildResetIterationPrompt(state)
    const newSessionID = await createIterationSession(
      ctx,
      options.previousSessionID,
      options.directory,
      state.iteration,
      state.max_iterations,
    )
    if (!newSessionID) {
      return
    }

    const boundState = options.loopState.setSessionID(newSessionID)
    if (!boundState) {
      log(`[${HOOK_NAME}] Failed to bind loop state to new session`, {
        previousSessionID: options.previousSessionID,
        newSessionID,
      })
      return
    }

    try {
      await injectContinuationPrompt(ctx, {
        sessionID: newSessionID,
        inheritFromSessionID: options.previousSessionID,
        prompt: resetPrompt,
        directory: options.directory,
        apiTimeoutMs: options.apiTimeoutMs,
      })
    } catch (error) {
      options.loopState.setSessionID(options.previousSessionID)
      throw error
    }

    await selectSessionInTui(ctx.client, newSessionID)

    return
  }

  const continuationPrompt = buildContinuationPrompt(state)

  await updateIterationSessionTitle(
    ctx.client,
    options.previousSessionID,
    options.directory,
    state.iteration,
    state.max_iterations,
  )

  await injectContinuationPrompt(ctx, {
    sessionID: options.previousSessionID,
    prompt: continuationPrompt,
    directory: options.directory,
    apiTimeoutMs: options.apiTimeoutMs,
  })
}
