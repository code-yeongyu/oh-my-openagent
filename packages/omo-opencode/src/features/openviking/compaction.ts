import type { Message, Part } from "@opencode-ai/sdk"
import { OpenVikingClient } from "./client"
import type { Session, SessionMessage } from "./types"
import type { OpenVikingConfig } from "../../config/schema/openviking"
import { OpenVikingError, OpenVikingTimeoutError, OpenVikingNetworkError } from "./types"

/**
 * Logger interface (compatible with OMO's logging)
 */
interface Logger {
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
}

/**
 * Default logger (console-based)
 */
const defaultLogger: Logger = {
  info: (message, data) => console.log(`[openviking] ${message}`, data ?? ""),
  warn: (message, data) => console.warn(`[openviking] ${message}`, data ?? ""),
  error: (message, data) => console.error(`[openviking] ${message}`, data ?? ""),
}

/**
 * Session compaction hook configuration
 */
export interface SessionCompactionHookConfig {
  /** OpenViking configuration */
  openviking: OpenVikingConfig
  
  /** Logger instance */
  logger?: Logger
}

/**
 * Session compacting hook input
 */
interface SessionCompactingInput {
  sessionID: string
}

/**
 * Session compacting hook output
 */
interface SessionCompactingOutput {
  context: string[]
  prompt?: string
}

/**
 * Create session compaction hook for experimental.session.compacting
 * 
 * This hook integrates with OpenCode's session compaction process,
 * leveraging OpenViking's memory extraction capabilities to generate
 * structured summaries during compaction.
 * 
 * @param config - Hook configuration
 * @returns Hook object with experimental.session.compacting method
 */
export function createSessionCompactionHook(config: SessionCompactionHookConfig) {
  const { openviking, logger = defaultLogger } = config

  // Create OpenViking client
  const client = new OpenVikingClient({
    url: openviking.url,
    api_key: openviking.api_key,
  })

  return {
    "experimental.session.compacting": async (
      input: SessionCompactingInput,
      output: SessionCompactingOutput
    ): Promise<void> => {
      // Skip if OpenViking is disabled
      if (!openviking.enabled) {
        return
      }

      const { sessionID } = input

      logger.info("Session compaction started", { sessionID })

      try {
        // Generate structured summary using OpenViking
        const summary = await generateStructuredSummary(
          sessionID,
          output.context,
          client,
          logger
        )

        if (summary) {
          // Add summary to context
          output.context.push(summary)

          logger.info("Structured summary added to compaction", {
            sessionID,
            summaryLength: summary.length,
          })
        }
      } catch (error) {
        // Handle errors gracefully - fall back to default compaction
        if (error instanceof OpenVikingTimeoutError) {
          logger.warn("Summary generation timed out, using default compaction", {
            sessionID,
            timeout_ms: error.timeout_ms,
          })
        } else if (error instanceof OpenVikingNetworkError) {
          logger.warn("Summary generation network error, using default compaction", {
            sessionID,
            error: error.message,
          })
        } else if (error instanceof OpenVikingError) {
          logger.error("Summary generation API error, using default compaction", {
            sessionID,
            error: error.message,
            statusCode: error.statusCode,
          })
        } else {
          logger.error("Summary generation unknown error, using default compaction", {
            sessionID,
            error: error instanceof Error ? error.message : String(error),
          })
        }

        // Continue with default compaction (graceful degradation)
      }
    },
  }
}

/**
 * Generate structured summary using OpenViking
 * 
 * @param sessionID - Session ID
 * @param context - Current context strings
 * @param client - OpenViking client
 * @param logger - Logger instance
 * @returns Structured summary or null if failed
 */
async function generateStructuredSummary(
  sessionID: string,
  context: string[],
  client: OpenVikingClient,
  logger: Logger
): Promise<string | null> {
  // Create a session object from context
  const session = createSessionFromContext(sessionID, context)

  // Skip if session is too small
  if (session.messages.length < 20) {
    logger.info("Session too small for compaction, skipping", {
      sessionID,
      messageCount: session.messages.length,
    })
    return null
  }

  try {
    // Commit session to OpenViking for memory extraction
    const response = await client.commit(session, true, true)

    if (!response.success) {
      logger.warn("Session commit failed during compaction", {
        sessionID,
        error: response.error,
      })
      return null
    }

    // Generate summary from context
    const summary = generateSummaryFromContext(context)

    return summary
  } catch (error) {
    logger.error("Failed to commit session during compaction", {
      sessionID,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Create a Session object from context strings
 */
function createSessionFromContext(sessionID: string, context: string[]): Session {
  const messages: SessionMessage[] = context.map((text, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: text,
    timestamp: new Date().toISOString(),
  }))

  return {
    id: sessionID,
    messages,
    created_at: new Date().toISOString(),
  }
}

/**
 * Generate summary from context
 * 
 * This is a simplified summary generation. In a real implementation,
 * OpenViking would provide a more sophisticated summary generation API.
 */
function generateSummaryFromContext(context: string[]): string {
  // Preserve recent context (last 10%)
  const recentCount = Math.max(5, Math.floor(context.length * 0.1))
  const recentContext = context.slice(-recentCount)

  // Generate summary sections
  const sections: string[] = []

  // Summary header
  sections.push("# Session Summary")
  sections.push("")

  // Key points (simplified)
  sections.push("## Key Points")
  sections.push("- Session was compacted to reduce token consumption")
  sections.push("- Recent context has been preserved")
  sections.push("")

  // Recent context
  sections.push("## Recent Context")
  for (const text of recentContext) {
    // Truncate long messages
    const truncated = text.length > 200 ? text.substring(0, 200) + "..." : text
    sections.push(`- ${truncated}`)
  }

  return sections.join("\n")
}

/**
 * Preserve recent messages during compaction
 * 
 * @param messages - All messages
 * @param percentage - Percentage to preserve (default: 10%)
 * @param minCount - Minimum number of messages to preserve (default: 5)
 * @returns Recent messages
 */
export function preserveRecentMessages(
  messages: SessionMessage[],
  percentage: number = 0.1,
  minCount: number = 5
): SessionMessage[] {
  const recentCount = Math.max(minCount, Math.floor(messages.length * percentage))
  return messages.slice(-recentCount)
}

/**
 * Check if session compaction integration is enabled
 */
export function isSessionCompactionEnabled(config: OpenVikingConfig): boolean {
  return config.enabled
}
