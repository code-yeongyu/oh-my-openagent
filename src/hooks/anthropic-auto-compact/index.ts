import type { PluginInput } from "@opencode-ai/plugin"
import type { AutoCompactState, ParsedTokenLimitError } from "./types"
import { parseAnthropicTokenLimitError } from "./parser"
import { executeCompact, getLastAssistant } from "./executor"

function createAutoCompactState(): AutoCompactState {
  return {
    pendingCompact: new Set<string>(),
    errorDataBySession: new Map<string, ParsedTokenLimitError>(),
    retryStateBySession: new Map(),
    fallbackStateBySession: new Map(),
  }
}

export function createAnthropicAutoCompactHook(ctx: PluginInput) {
  const autoCompactState = createAutoCompactState()

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        autoCompactState.pendingCompact.delete(sessionInfo.id)
        autoCompactState.errorDataBySession.delete(sessionInfo.id)
        autoCompactState.retryStateBySession.delete(sessionInfo.id)
        autoCompactState.fallbackStateBySession.delete(sessionInfo.id)
      }
      return
    }

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      const parsed = parseAnthropicTokenLimitError(props?.error)
      if (parsed) {
        autoCompactState.pendingCompact.add(sessionID)
        autoCompactState.errorDataBySession.set(sessionID, parsed)
      }
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined

      if (sessionID && info?.role === "assistant" && info.error) {
        const parsed = parseAnthropicTokenLimitError(info.error)
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
      if (errorData?.providerID && errorData?.modelID) {
        await ctx.client.tui
          .showToast({
            body: {
              title: "Auto Compact",
              message: "Token limit exceeded. Summarizing session...",
              variant: "warning" as const,
              duration: 3000,
            },
          })
          .catch(() => {})

        await executeCompact(
          sessionID,
          { providerID: errorData.providerID, modelID: errorData.modelID },
          autoCompactState,
          ctx.client,
          ctx.directory
        )
        return
      }

      const lastAssistant = await getLastAssistant(sessionID, ctx.client, ctx.directory)
      if (!lastAssistant) {
        autoCompactState.pendingCompact.delete(sessionID)
        return
      }

      if (lastAssistant.summary === true) {
        autoCompactState.pendingCompact.delete(sessionID)
        return
      }

      if (!lastAssistant.modelID || !lastAssistant.providerID) {
        autoCompactState.pendingCompact.delete(sessionID)
        return
      }

      await ctx.client.tui
        .showToast({
          body: {
            title: "Auto Compact",
            message: "Token limit exceeded. Summarizing session...",
            variant: "warning" as const,
            duration: 3000,
          },
        })
        .catch(() => {})

      await executeCompact(sessionID, lastAssistant, autoCompactState, ctx.client, ctx.directory)
    }
  }

  return {
    event: eventHandler,
  }
}

export type { AutoCompactState, FallbackState, ParsedTokenLimitError } from "./types"
export { parseAnthropicTokenLimitError } from "./parser"
export { executeCompact, getLastAssistant } from "./executor"
