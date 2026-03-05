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
  const continuationPrompt = buildContinuationPrompt(state)

  if (strategy === "reset") {
    const newSessionID = await createIterationSession(
      ctx,
      options.previousSessionID,
      options.directory,
    )
    if (!newSessionID) {
      return
    }

    await injectContinuationPrompt(ctx, {
      sessionID: newSessionID,
      inheritFromSessionID: options.previousSessionID,
      prompt: continuationPrompt,
      directory: options.directory,
      apiTimeoutMs: options.apiTimeoutMs,
    })

    await selectSessionInTui(ctx.client, newSessionID)

    const boundState = options.loopState.setSessionID(newSessionID)
    if (!boundState) {
      log(`[${HOOK_NAME}] Failed to bind loop state to new session`, {
        previousSessionID: options.previousSessionID,
        newSessionID,
      })
      return
    }

    return
  }

  await injectContinuationPrompt(ctx, {
    sessionID: options.previousSessionID,
    prompt: continuationPrompt,
    directory: options.directory,
    apiTimeoutMs: options.apiTimeoutMs,
  })
}
