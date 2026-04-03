import type { PluginInput } from "@opencode-ai/plugin"
import type { Client } from "./client"
import type { AutoCompactState, ParsedTokenLimitError } from "./types"
import type { ExperimentalConfig, OhMyOpenCodeConfig } from "../../config"
import { parseAnthropicTokenLimitError } from "./parser"
import { executeCompact, getLastAssistant } from "./executor"
import { attemptDeduplicationRecovery } from "./deduplication-recovery"
import { clearSessionState } from "./state"
import { log } from "../../shared/logger"

export interface AnthropicContextWindowLimitRecoveryOptions {
  experimental?: ExperimentalConfig
  pluginConfig: OhMyOpenCodeConfig
  dependencies?: {
    executeCompact?: typeof executeCompact
    getLastAssistant?: typeof getLastAssistant
    log?: typeof log
    parseAnthropicTokenLimitError?: typeof parseAnthropicTokenLimitError
  }
}

function createRecoveryState(): AutoCompactState {
  return {
    pendingCompact: new Set<string>(),
    errorDataBySession: new Map<string, ParsedTokenLimitError>(),
    retryStateBySession: new Map(),
    retryTimerBySession: new Map(),
    truncateStateBySession: new Map(),
    emptyContentAttemptBySession: new Map(),
    compactionInProgress: new Set<string>(),
  }
}


export function createAnthropicContextWindowLimitRecoveryHook(
  ctx: PluginInput,
  options?: AnthropicContextWindowLimitRecoveryOptions,
) {
  const autoCompactState = createRecoveryState()
  const experimental = options?.experimental
  const pluginConfig = options?.pluginConfig ?? {} as OhMyOpenCodeConfig
  const dependencies = {
    executeCompact,
    getLastAssistant,
    log,
    parseAnthropicTokenLimitError,
    ...options?.dependencies,
  }
  const pendingCompactionTimeoutBySession = new Map<string, ReturnType<typeof setTimeout>>()

  function clearPendingCompactionTimeout(sessionID: string): void {
    const timeoutID = pendingCompactionTimeoutBySession.get(sessionID)
    if (timeoutID !== undefined) {
      clearTimeout(timeoutID)
      pendingCompactionTimeoutBySession.delete(sessionID)
    }
  }

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        clearPendingCompactionTimeout(sessionInfo.id)

        clearSessionState(autoCompactState, sessionInfo.id)
      }
      return
    }

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      dependencies.log("[auto-compact] session.error received", { sessionID, error: props?.error })
      if (!sessionID) return

      const parsed = dependencies.parseAnthropicTokenLimitError(props?.error)
      dependencies.log("[auto-compact] parsed result", { parsed, hasError: !!props?.error })
      if (parsed) {
        autoCompactState.pendingCompact.add(sessionID)
        autoCompactState.errorDataBySession.set(sessionID, parsed)

        if (autoCompactState.compactionInProgress.has(sessionID)) {
          await attemptDeduplicationRecovery(sessionID, parsed, experimental, ctx.client)
          return
        }

        const lastAssistant = await dependencies.getLastAssistant(
          sessionID,
          ctx.client,
          ctx.directory,
        )
        const lastAssistantInfo = lastAssistant?.info
        const providerID = parsed.providerID ?? (lastAssistantInfo?.providerID as string | undefined)
        const modelID = parsed.modelID ?? (lastAssistantInfo?.modelID as string | undefined)

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

        clearPendingCompactionTimeout(sessionID)

        const timeoutID = setTimeout(() => {
          pendingCompactionTimeoutBySession.delete(sessionID)
          dependencies.executeCompact(
            sessionID,
            { providerID, modelID },
            autoCompactState,
            ctx.client as Client,
            ctx.directory,
            pluginConfig,
            experimental,
          )
        }, 300)

        pendingCompactionTimeoutBySession.set(sessionID, timeoutID)
      }
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined

      if (sessionID && info?.role === "assistant" && info.error) {
        dependencies.log("[auto-compact] message.updated with error", { sessionID, error: info.error })
        const parsed = dependencies.parseAnthropicTokenLimitError(info.error)
        dependencies.log("[auto-compact] message.updated parsed result", { parsed })
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

      clearPendingCompactionTimeout(sessionID)

      const errorData = autoCompactState.errorDataBySession.get(sessionID)
      const lastAssistant = await dependencies.getLastAssistant(
        sessionID,
        ctx.client,
        ctx.directory,
      )
      const lastAssistantInfo = lastAssistant?.info

      if (lastAssistantInfo?.summary === true && lastAssistant?.hasContent) {
        clearSessionState(autoCompactState, sessionID)
        return
      }

      const providerID = errorData?.providerID ?? (lastAssistantInfo?.providerID as string | undefined)
      const modelID = errorData?.modelID ?? (lastAssistantInfo?.modelID as string | undefined)

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

      await dependencies.executeCompact(
        sessionID,
        { providerID, modelID },
        autoCompactState,
        ctx.client as Client,
        ctx.directory,
        pluginConfig,
        experimental,
      )
    }
  }

  return {
    event: eventHandler,
  }
}
