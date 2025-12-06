import type { PluginInput } from "@opencode-ai/plugin"

const ANTHROPIC_ACTUAL_LIMIT = 200_000
const CHARS_PER_TOKEN_ESTIMATE = 4
const TARGET_MAX_TOKENS = 50_000

interface AssistantMessageInfo {
  role: "assistant"
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

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE)
}

function truncateToTokenLimit(output: string, maxTokens: number): { result: string; truncated: boolean } {
  const currentTokens = estimateTokens(output)

  if (currentTokens <= maxTokens) {
    return { result: output, truncated: false }
  }

  const lines = output.split("\n")

  if (lines.length <= 3) {
    const maxChars = maxTokens * CHARS_PER_TOKEN_ESTIMATE
    return {
      result: output.slice(0, maxChars) + "\n\n[Output truncated due to context window limit]",
      truncated: true,
    }
  }

  const headerLines = lines.slice(0, 3)
  const contentLines = lines.slice(3)

  const headerText = headerLines.join("\n")
  const headerTokens = estimateTokens(headerText)
  const availableTokens = maxTokens - headerTokens - 50

  if (availableTokens <= 0) {
    return {
      result: headerText + "\n\n[Content truncated due to context window limit]",
      truncated: true,
    }
  }

  let resultLines: string[] = []
  let currentTokenCount = 0

  for (const line of contentLines) {
    const lineTokens = estimateTokens(line + "\n")
    if (currentTokenCount + lineTokens > availableTokens) {
      break
    }
    resultLines.push(line)
    currentTokenCount += lineTokens
  }

  const truncatedContent = [...headerLines, ...resultLines].join("\n")
  const removedCount = contentLines.length - resultLines.length

  return {
    result: truncatedContent + `\n\n[${removedCount} more lines truncated due to context window limit]`,
    truncated: true,
  }
}

export function createGrepOutputTruncatorHook(ctx: PluginInput) {
  const GREP_TOOLS = ["safe_grep", "Grep"]

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown }
  ) => {
    if (!GREP_TOOLS.includes(input.tool)) return

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

      const totalInputTokens = assistantMessages.reduce((sum, m) => {
        const inputTokens = m.tokens?.input ?? 0
        const cacheReadTokens = m.tokens?.cache?.read ?? 0
        return sum + inputTokens + cacheReadTokens
      }, 0)

      const remainingTokens = ANTHROPIC_ACTUAL_LIMIT - totalInputTokens

      const maxOutputTokens = Math.min(
        remainingTokens * 0.5,
        TARGET_MAX_TOKENS
      )

      if (maxOutputTokens <= 0) {
        output.output = "[Output suppressed - context window exhausted]"
        return
      }

      const { result, truncated } = truncateToTokenLimit(output.output, maxOutputTokens)
      if (truncated) {
        output.output = result
      }
    } catch {
      // Graceful degradation
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
  }
}
