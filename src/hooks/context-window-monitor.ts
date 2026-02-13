import type { PluginInput } from "@opencode-ai/plugin"
import { createSystemDirective, SystemDirectiveTypes } from "../shared/system-directive"

const ANTHROPIC_DISPLAY_LIMIT = 1_000_000
const ANTHROPIC_ACTUAL_LIMIT =
  process.env.ANTHROPIC_1M_CONTEXT === "true" ||
  process.env.VERTEX_ANTHROPIC_1M_CONTEXT === "true"
    ? 1_000_000
    : 200_000
const CONTEXT_WARNING_THRESHOLD = 0.70

const CONTEXT_REMINDER = `${createSystemDirective(SystemDirectiveTypes.CONTEXT_WINDOW_MONITOR)}

You are using Anthropic Claude with 1M context window.
You have plenty of context remaining - do NOT rush or skip tasks.
Complete your work thoroughly and methodically.`

interface TokenInfo {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

interface CachedTokenState {
  providerID: string
  tokens: TokenInfo
}

export function createContextWindowMonitorHook(ctx: PluginInput) {
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

    if (cached.providerID !== "anthropic") return

    const lastTokens = cached.tokens
    const totalInputTokens = (lastTokens?.input ?? 0) + (lastTokens?.cache?.read ?? 0)

    const actualUsagePercentage = totalInputTokens / ANTHROPIC_ACTUAL_LIMIT

    if (actualUsagePercentage < CONTEXT_WARNING_THRESHOLD) return

    remindedSessions.add(sessionID)

    const displayUsagePercentage = totalInputTokens / ANTHROPIC_DISPLAY_LIMIT
    const usedPct = (displayUsagePercentage * 100).toFixed(1)
    const remainingPct = ((1 - displayUsagePercentage) * 100).toFixed(1)
    const usedTokens = totalInputTokens.toLocaleString()
    const limitTokens = ANTHROPIC_DISPLAY_LIMIT.toLocaleString()

    output.output += `\n\n${CONTEXT_REMINDER}
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
        finish?: boolean
        tokens?: TokenInfo
      } | undefined

      if (!info || info.role !== "assistant" || !info.finish) return
      if (!info.sessionID || !info.providerID || !info.tokens) return

      tokenCache.set(info.sessionID, {
        providerID: info.providerID,
        tokens: info.tokens,
      })
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}
