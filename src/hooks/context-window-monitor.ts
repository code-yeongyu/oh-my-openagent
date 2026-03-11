import type { PluginInput } from "@opencode-ai/plugin"
import { createSystemDirective, SystemDirectiveTypes } from "../shared/system-directive"

const DEFAULT_ANTHROPIC_ACTUAL_LIMIT = 200_000
const CONTEXT_WARNING_THRESHOLD = 0.70

type ModelCacheStateLike = {
  anthropicContext1MEnabled: boolean
  modelContextLimitsCache?: Map<string, number>
}

function getAnthropicActualLimit(modelCacheState?: ModelCacheStateLike): number {
  return (modelCacheState?.anthropicContext1MEnabled ?? false) ||
    process.env.ANTHROPIC_1M_CONTEXT === "true" ||
    process.env.VERTEX_ANTHROPIC_1M_CONTEXT === "true"
    ? 1_000_000
    : DEFAULT_ANTHROPIC_ACTUAL_LIMIT
}

function createContextReminder(actualLimit: number): string {
  const limitTokens = actualLimit.toLocaleString()

  return `${createSystemDirective(SystemDirectiveTypes.CONTEXT_WINDOW_MONITOR)}

You are using a ${limitTokens}-token context window.
You still have context remaining - do NOT rush or skip tasks.
Complete your work thoroughly and methodically.`
}

interface TokenInfo {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

interface CachedTokenState {
  providerID: string
  modelID: string
  tokens: TokenInfo
}

function isAnthropicProvider(providerID: string): boolean {
  return providerID === "anthropic" || providerID === "google-vertex-anthropic"
}

export function createContextWindowMonitorHook(
  _ctx: PluginInput,
  modelCacheState?: ModelCacheStateLike,
) {
  const remindedSessions = new Set<string>()
  const tokenCache = new Map<string, CachedTokenState>()

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown }
  ) => {
    const { sessionID } = input

    if (remindedSessions.has(sessionID)) return

    const cached = tokenCache.get(sessionID)
    if (!cached) return

    const modelSpecificLimit = !isAnthropicProvider(cached.providerID)
      ? modelCacheState?.modelContextLimitsCache?.get(`${cached.providerID}/${cached.modelID}`)
      : undefined
    const actualLimit = isAnthropicProvider(cached.providerID)
      ? getAnthropicActualLimit(modelCacheState)
      : modelSpecificLimit

    if (!actualLimit) return

    const lastTokens = cached.tokens
    const totalInputTokens = (lastTokens?.input ?? 0) + (lastTokens?.cache?.read ?? 0)

    const actualUsagePercentage = totalInputTokens / actualLimit

    if (actualUsagePercentage < CONTEXT_WARNING_THRESHOLD) return

    remindedSessions.add(sessionID)

    const usedPct = (actualUsagePercentage * 100).toFixed(1)
    const remainingPct = ((1 - actualUsagePercentage) * 100).toFixed(1)
    const usedTokens = totalInputTokens.toLocaleString()
    const limitTokens = actualLimit.toLocaleString()

    output.output += `\n\n${createContextReminder(actualLimit)}
[Context Status: ${usedPct}% used (${usedTokens}/${limitTokens} tokens), ${remainingPct}% remaining]`
  }

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        remindedSessions.delete(sessionInfo.id)
        tokenCache.delete(sessionInfo.id)
      }
    }

    if (event.type === "message.updated") {
      const info = props?.info as {
        role?: string
        sessionID?: string
        providerID?: string
        modelID?: string
        finish?: boolean
        tokens?: TokenInfo
      } | undefined

      if (!info || info.role !== "assistant" || !info.finish) return
      if (!info.sessionID || !info.providerID || !info.tokens) return

      tokenCache.set(info.sessionID, {
        providerID: info.providerID,
        modelID: info.modelID ?? "",
        tokens: info.tokens,
      })
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}
