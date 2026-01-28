/**
 * Represents a tool call extracted from session messages
 */
export interface ToolCall {
  name: string
  success: boolean
}

/**
 * Pattern extracted from session history
 */
export interface ExtractedPattern {
  name: string
  trigger: string
  confidence: number
  action: string
  domain: string
  source: {
    sessionId: string
    taskName?: string
  }
}

/**
 * Session message structure (simplified)
 */
export interface SessionMessage {
  role: string
  content: Array<{
    type: string
    name?: string
    tool_use_id?: string
    content?: string
    is_error?: boolean
    text?: string
  }>
}

const SEQUENCE_LENGTH = 3
const MIN_OCCURRENCES = 3
const CONFIDENCE_THRESHOLD = 0.7

/**
 * Analyzes session history to extract behavioral patterns
 */
export class PatternAnalyzer {
  /**
   * Extracts tool calls from session messages
   * Only includes successful tool calls (no errors)
   */
  extractToolCalls(messages: SessionMessage[]): ToolCall[] {
    const toolCalls: ToolCall[] = []

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i]

      // Look for assistant messages with tool_use
      if (message.role === "assistant") {
        for (const content of message.content) {
          if (content.type === "tool_use" && content.name) {
            // Check the next user message for tool_result to determine success
            const nextMessage = messages[i + 1]
            let success = true

            if (nextMessage && nextMessage.role === "user") {
              for (const resultContent of nextMessage.content) {
                if (
                  resultContent.type === "tool_result" &&
                  resultContent.tool_use_id === content.tool_use_id
                ) {
                  success = !resultContent.is_error
                  break
                }
              }
            }

            if (success) {
              toolCalls.push({
                name: content.name,
                success: true,
              })
            }
          }
        }
      }
    }

    return toolCalls
  }

  /**
   * Analyzes tool call sequences to find repeated patterns
   */
  analyzePatterns(
    toolCalls: ToolCall[],
    sessionId: string,
    taskName?: string
  ): ExtractedPattern[] {
    const patterns: ExtractedPattern[] = []

    if (toolCalls.length < SEQUENCE_LENGTH * MIN_OCCURRENCES) {
      return patterns
    }

    // Extract sequences and count occurrences
    const sequences = new Map<string, number>()

    for (let i = 0; i <= toolCalls.length - SEQUENCE_LENGTH; i++) {
      const sequence = toolCalls
        .slice(i, i + SEQUENCE_LENGTH)
        .map((call) => call.name)
        .join("->")

      sequences.set(sequence, (sequences.get(sequence) || 0) + 1)
    }

    // Find sequences that meet minimum occurrence threshold
    for (const [sequence, count] of sequences) {
      if (count >= MIN_OCCURRENCES) {
        const confidence = Math.min(0.9, 0.5 + count * 0.1)

        if (confidence >= CONFIDENCE_THRESHOLD) {
          const tools = sequence.split("->")
          patterns.push({
            name: "repeated-workflow",
            trigger: `Repeated sequence: ${sequence}`,
            confidence,
            action: `Consider creating a shortcut for: ${tools.join(" → ")}`,
            domain: "workflow-optimization",
            source: {
              sessionId,
              taskName,
            },
          })
        }
      }
    }

    return patterns
  }

  /**
   * Main analysis entry point
   */
  analyze(
    messages: SessionMessage[],
    sessionId: string,
    taskName?: string
  ): ExtractedPattern[] {
    const toolCalls = this.extractToolCalls(messages)
    return this.analyzePatterns(toolCalls, sessionId, taskName)
  }
}
