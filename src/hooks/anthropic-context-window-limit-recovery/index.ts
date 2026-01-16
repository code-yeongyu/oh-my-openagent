import type { PluginInput } from "@opencode-ai/plugin"
import type { AutoCompactState, ParsedTokenLimitError } from "./types"
import type { ExperimentalConfig } from "../../config"
import { parseAnthropicTokenLimitError } from "./parser"
import { executeCompact, getLastAssistant } from "./executor"
import { log } from "../../shared/logger"

export interface AnthropicContextWindowLimitRecoveryOptions {
  experimental?: ExperimentalConfig
}

function createRecoveryState(): AutoCompactState {
  return {
    pendingCompact: new Set<string>(),
    errorDataBySession: new Map<string, ParsedTokenLimitError>(),
    retryStateBySession: new Map(),
    truncateStateBySession: new Map(),
    emptyContentAttemptBySession: new Map(),
    compactionInProgress: new Set<string>(),
  }
}

export function createAnthropicContextWindowLimitRecoveryHook(ctx: PluginInput, options?: AnthropicContextWindowLimitRecoveryOptions) {
  const autoCompactState = createRecoveryState()
  const experimental = options?.experimental

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        autoCompactState.pendingCompact.delete(sessionInfo.id)
        autoCompactState.errorDataBySession.delete(sessionInfo.id)
        autoCompactState.retryStateBySession.delete(sessionInfo.id)
        autoCompactState.truncateStateBySession.delete(sessionInfo.id)
        autoCompactState.emptyContentAttemptBySession.delete(sessionInfo.id)
        autoCompactState.compactionInProgress.delete(sessionInfo.id)
      }
      return
    }

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      log("[auto-compact] session.error received", { sessionID, error: props?.error })
      if (!sessionID) return

      const parsed = parseAnthropicTokenLimitError(props?.error)
      log("[auto-compact] parsed result", { parsed, hasError: !!props?.error })
      if (parsed) {
        autoCompactState.pendingCompact.add(sessionID)
        autoCompactState.errorDataBySession.set(sessionID, parsed)

        if (autoCompactState.compactionInProgress.has(sessionID)) {
          return
        }

        const lastAssistant = await getLastAssistant(sessionID, ctx.client, ctx.directory)
        const providerID = parsed.providerID ?? (lastAssistant?.providerID as string | undefined)
        const modelID = parsed.modelID ?? (lastAssistant?.modelID as string | undefined)

        await ctx.client.tui
          .showToast({
            body: {
              title: "Context Limit Hit",
              message: "Truncating large tool outputs and recovering...",
              variant: "warning" as const,
              duration: 3000,
            },
          })
          .catch(() => {})

        setTimeout(() => {
          executeCompact(
            sessionID,
            { providerID, modelID },
            autoCompactState,
            ctx.client,
            ctx.directory,
            experimental
          )
        }, 300)
      }
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined

      if (sessionID && info?.role === "assistant" && info.error) {
        log("[auto-compact] message.updated with error", { sessionID, error: info.error })
        const parsed = parseAnthropicTokenLimitError(info.error)
        log("[auto-compact] message.updated parsed result", { parsed })
        if (parsed) {
          parsed.providerID = info.providerID as string | undefined
          parsed.modelID = info.modelID as string | undefined
          autoCompactState.pendingCompact.add(sessionID)
          autoCompactState.errorDataBySession.set(sessionID, parsed)
        }
      }
      return
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      if (!autoCompactState.pendingCompact.has(sessionID)) return

      const errorData = autoCompactState.errorDataBySession.get(sessionID)
      const lastAssistant = await getLastAssistant(sessionID, ctx.client, ctx.directory)

      if (lastAssistant?.summary === true) {
        autoCompactState.pendingCompact.delete(sessionID)
        return
      }

      const providerID = errorData?.providerID ?? (lastAssistant?.providerID as string | undefined)
      const modelID = errorData?.modelID ?? (lastAssistant?.modelID as string | undefined)

      await ctx.client.tui
        .showToast({
          body: {
            title: "Auto Compact",
            message: "Token limit exceeded. Attempting recovery...",
            variant: "warning" as const,
            duration: 3000,
          },
        })
        .catch(() => {})

      await executeCompact(
        sessionID,
        { providerID, modelID },
        autoCompactState,
        ctx.client,
        ctx.directory,
        experimental
      )
    }
  }

  return {
    event: eventHandler,
  }
}

export type { AutoCompactState, ParsedTokenLimitError, TruncateState } from "./types"
export { parseAnthropicTokenLimitError } from "./parser"
export { executeCompact, getLastAssistant } from "./executor"
