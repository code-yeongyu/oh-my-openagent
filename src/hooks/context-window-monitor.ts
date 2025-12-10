import type { PluginInput } from "@opencode-ai/plugin"

const ANTHROPIC_DISPLAY_LIMIT = 1_000_000
const ANTHROPIC_ACTUAL_LIMIT = 200_000
const CONTEXT_WARNING_THRESHOLD = 0.70

const CONTEXT_REMINDER = `[SYSTEM REMINDER - 1M Context Window]

You are using Anthropic Claude with 1M context window.
You have plenty of context remaining - do NOT rush or skip tasks.
Complete your work thoroughly and methodically.`

interface AssistantMessageInfo {
  role: "assistant"
  providerID: string
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}

interface MessageWrapper {
  info: { role: string } & Partial<AssistantMessageInfo>
}

export function createContextWindowMonitorHook(ctx: PluginInput) {
  const remindedSessions = new Set<string>()

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown }
  ) => {
    const { sessionID } = input

    if (remindedSessions.has(sessionID)) return

    try {
      const response = await ctx.client.session.messages({
        path: { id: sessionID },
      })

      const messages = (response.data ?? response) as MessageWrapper[]

      const assistantMessages = messages
        .filter((m) => m.info.role === "assistant")
        .map((m) => m.info as AssistantMessageInfo)

      if (assistantMessages.length === 0) return

      const lastAssistant = assistantMessages[assistantMessages.length - 1]
      if (lastAssistant.providerID !== "anthropic") return

      const totalInputTokens = assistantMessages.reduce((sum, m) => {
        const inputTokens = m.tokens?.input ?? 0
        const cacheReadTokens = m.tokens?.cache?.read ?? 0
        return sum + inputTokens + cacheReadTokens
      }, 0)

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
    } catch {
      // Graceful degradation - do not disrupt tool execution
    }
  }

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        remindedSessions.delete(sessionInfo.id)
      }
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}
