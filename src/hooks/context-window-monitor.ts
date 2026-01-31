import type { PluginInput } from "@opencode-ai/plugin"
import { createSystemDirective, SystemDirectiveTypes } from "../shared/system-directive"

const ANTHROPIC_DISPLAY_LIMIT = 1_000_000
const ANTHROPIC_ACTUAL_LIMIT =
  process.env.ANTHROPIC_1M_CONTEXT === "true" ||
  process.env.VERTEX_ANTHROPIC_1M_CONTEXT === "true"
    ? 1_000_000
    : 200_000

const PROGRESSIVE_WARNING_THRESHOLDS = [0.50, 0.60, 0.70, 0.80] as const

type ThresholdLevel = (typeof PROGRESSIVE_WARNING_THRESHOLDS)[number]

const ANSI = {
  RESET: "\x1b[0m",
  BOLD: "\x1b[1m",
  BLUE: "\x1b[34m",
  YELLOW: "\x1b[33m",
  ORANGE: "\x1b[38;5;208m",
  RED: "\x1b[31m",
  BG_BLUE: "\x1b[44m",
  BG_YELLOW: "\x1b[43m",
  BG_ORANGE: "\x1b[48;5;208m",
  BG_RED: "\x1b[41m",
  WHITE: "\x1b[37m",
} as const

const THRESHOLD_CONFIG: Record<ThresholdLevel, { emoji: string; urgency: string; color: string; bgColor: string }> = {
  0.50: { emoji: "📊", urgency: "INFO", color: ANSI.BLUE, bgColor: ANSI.BG_BLUE },
  0.60: { emoji: "📈", urgency: "NOTICE", color: ANSI.YELLOW, bgColor: ANSI.BG_YELLOW },
  0.70: { emoji: "⚠️", urgency: "WARNING", color: ANSI.ORANGE, bgColor: ANSI.BG_ORANGE },
  0.80: { emoji: "🚨", urgency: "CRITICAL", color: ANSI.RED, bgColor: ANSI.BG_RED },
}

function createContextReminder(threshold: ThresholdLevel): string {
  const { emoji, urgency, color, bgColor } = THRESHOLD_CONFIG[threshold]
  const baseReminder = createSystemDirective(SystemDirectiveTypes.CONTEXT_WINDOW_MONITOR)

  const coloredHeader = `${bgColor}${ANSI.WHITE}${ANSI.BOLD} ${emoji} [${urgency}] ${ANSI.RESET}${color}`

  if (threshold >= 0.80) {
    return `${baseReminder}

${coloredHeader} Context window is running LOW!
Consider wrapping up current task or preparing for session handoff.
Prioritize completing critical work before context limit is reached.${ANSI.RESET}`
  }

  if (threshold >= 0.70) {
    return `${baseReminder}

${coloredHeader} Context window usage is getting high.
Continue working but be mindful of context consumption.
Consider summarizing progress if approaching complex tasks.${ANSI.RESET}`
  }

  return `${baseReminder}

${coloredHeader} Context window checkpoint.
You have sufficient context remaining - continue working normally.${ANSI.RESET}`
}

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
  const notifiedThresholdsPerSession = new Map<string, Set<ThresholdLevel>>()

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown }
  ) => {
    const { sessionID } = input

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

      const lastTokens = lastAssistant.tokens
      const totalInputTokens = (lastTokens?.input ?? 0) + (lastTokens?.cache?.read ?? 0)
      const actualUsagePercentage = totalInputTokens / ANTHROPIC_ACTUAL_LIMIT

      if (!notifiedThresholdsPerSession.has(sessionID)) {
        notifiedThresholdsPerSession.set(sessionID, new Set())
      }
      const sessionNotified = notifiedThresholdsPerSession.get(sessionID)!

      let thresholdToNotify: ThresholdLevel | null = null
      for (const threshold of PROGRESSIVE_WARNING_THRESHOLDS) {
        if (actualUsagePercentage >= threshold && !sessionNotified.has(threshold)) {
          thresholdToNotify = threshold
        }
      }

      if (thresholdToNotify === null) return

      for (const threshold of PROGRESSIVE_WARNING_THRESHOLDS) {
        if (threshold <= thresholdToNotify) {
          sessionNotified.add(threshold)
        }
      }

      const { color } = THRESHOLD_CONFIG[thresholdToNotify]
      const displayUsagePercentage = totalInputTokens / ANTHROPIC_DISPLAY_LIMIT
      const usedPct = (displayUsagePercentage * 100).toFixed(1)
      const remainingPct = ((1 - displayUsagePercentage) * 100).toFixed(1)
      const usedTokens = totalInputTokens.toLocaleString()
      const limitTokens = ANTHROPIC_DISPLAY_LIMIT.toLocaleString()

      const reminder = createContextReminder(thresholdToNotify)

      output.output += `\n\n${reminder}
${color}[Context Status: ${usedPct}% used (${usedTokens}/${limitTokens} tokens), ${remainingPct}% remaining]${ANSI.RESET}`
    } catch {
      // Graceful degradation
    }
  }

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        notifiedThresholdsPerSession.delete(sessionInfo.id)
      }
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}
