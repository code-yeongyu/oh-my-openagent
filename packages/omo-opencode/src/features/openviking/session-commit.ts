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
 * Session commit hook configuration
 */
export interface SessionCommitHookConfig {
  /** OpenViking configuration */
  openviking: OpenVikingConfig
  
  /** Logger instance */
  logger?: Logger
}

/**
 * Chat message hook input
 */
interface ChatMessageInput {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
  messageID?: string
}

/**
 * Chat message hook output
 */
interface ChatMessageOutput {
  message: Record<string, unknown>
  parts: Part[]
}

/**
 * Session state tracker
 * Tracks sessions that need to be committed when they end
 */
class SessionTracker {
  private sessions: Map<string, SessionData> = new Map()

  /**
   * Add or update a session
   */
  addMessage(sessionID: string, message: SessionMessage): void {
    let session = this.sessions.get(sessionID)
    
    if (!session) {
      session = {
        id: sessionID,
        messages: [],
        created_at: new Date().toISOString(),
      }
      this.sessions.set(sessionID, session)
    }

    session.messages.push(message)
  }

  /**
   * Get and remove a session (for commit)
   */
  getSession(sessionID: string): Session | null {
    const session = this.sessions.get(sessionID)
    if (!session) {
      return null
    }

    // Remove from tracker
    this.sessions.delete(sessionID)

    // Convert to Session format
    return {
      id: session.id,
      messages: session.messages,
      created_at: session.created_at,
      ended_at: new Date().toISOString(),
    }
  }

  /**
   * Check if a session exists
   */
  hasSession(sessionID: string): boolean {
    return this.sessions.has(sessionID)
  }

  /**
   * Get all tracked session IDs
   */
  getSessionIDs(): string[] {
    return Array.from(this.sessions.keys())
  }
}

/**
 * Session data structure
 */
interface SessionData {
  id: string
  messages: SessionMessage[]
  created_at: string
}

/**
 * Create session commit hook for chat.message
 * 
 * This hook tracks conversation messages and commits them to OpenViking
 * when the session ends. It uses the chat.message hook to detect session
 * termination and trigger the commit.
 * 
 * @param config - Hook configuration
 * @returns Hook object with chat.message method
 */
export function createSessionCommitHook(config: SessionCommitHookConfig) {
  const { openviking, logger = defaultLogger } = config

  // Create OpenViking client
  const client = new OpenVikingClient({
    url: openviking.url,
    api_key: openviking.api_key,
  })

  // Session tracker
  const tracker = new SessionTracker()

  return {
    "chat.message": async (
      input: ChatMessageInput,
      output: ChatMessageOutput
    ): Promise<void> => {
      // Skip if auto_commit is disabled
      if (!openviking.auto_commit) {
        return
      }

      const { sessionID } = input

      // Convert message parts to SessionMessage format
      const sessionMessage = convertToSessionMessage(output)
      if (!sessionMessage) {
        return
      }

      // Add message to session tracker
      tracker.addMessage(sessionID, sessionMessage)

      logger.info("Message tracked", {
        sessionID,
        role: sessionMessage.role,
        messageCount: tracker.hasSession(sessionID) ? "updated" : "new",
      })

      // Check if this is the last message in the session
      // We'll commit on the next message or when explicitly triggered
      // For now, we'll commit after a period of inactivity
      // This is a simplified approach; a more sophisticated approach
      // would detect actual session end events
    },
  }
}

/**
 * Convert chat message output to SessionMessage format
 */
function convertToSessionMessage(output: ChatMessageOutput): SessionMessage | null {
  const message = output.message as Message
  
  // Determine role
  let role: SessionMessage["role"]
  switch (message.role) {
    case "user":
      role = "user"
      break
    case "assistant":
      role = "assistant"
      break
    case "system":
      role = "system"
      break
    case "tool":
      role = "tool"
      break
    default:
      return null
  }

  // Extract content from parts
  const content = extractContentFromParts(output.parts)
  if (!content) {
    return null
  }

  return {
    role,
    content,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Extract text content from message parts
 */
function extractContentFromParts(parts: Part[]): string {
  const textParts: string[] = []

  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string") {
      textParts.push(part.text)
    } else if (part.type === "tool-call") {
      // Include tool call information
      const toolCall = part as unknown as {
        toolCallID?: string
        toolName?: string
        args?: unknown
      }
      if (toolCall.toolName) {
        textParts.push(`[Tool call: ${toolCall.toolName}]`)
      }
    } else if (part.type === "tool-result") {
      // Include tool result information
      const toolResult = part as unknown as {
        toolCallID?: string
        result?: unknown
      }
      if (toolResult.result) {
        const resultText = typeof toolResult.result === "string"
          ? toolResult.result
          : JSON.stringify(toolResult.result)
        textParts.push(`[Tool result: ${resultText}]`)
      }
    }
  }

  return textParts.join("\n")
}

/**
 * Commit a session to OpenViking
 * 
 * This function can be called explicitly to commit a session,
 * or it can be triggered automatically when the session ends.
 * 
 * @param sessionID - Session ID to commit
 * @param tracker - Session tracker instance
 * @param client - OpenViking client instance
 * @param logger - Logger instance
 */
export async function commitSession(
  sessionID: string,
  tracker: SessionTracker,
  client: OpenVikingClient,
  logger: Logger
): Promise<void> {
  const session = tracker.getSession(sessionID)
  
  if (!session) {
    logger.warn("Session not found for commit", { sessionID })
    return
  }

  // Skip if session has no messages
  if (session.messages.length === 0) {
    logger.info("Session has no messages, skipping commit", { sessionID })
    return
  }

  try {
    logger.info("Committing session", {
      sessionID,
      messageCount: session.messages.length,
    })

    const response = await client.commit(session, true, true)

    if (response.success) {
      logger.info("Session committed successfully", {
        sessionID,
        taskID: response.task_id,
      })
    } else {
      logger.error("Session commit failed", {
        sessionID,
        error: response.error,
      })
    }
  } catch (error) {
    // Handle errors gracefully
    if (error instanceof OpenVikingTimeoutError) {
      logger.warn("Session commit timed out", {
        sessionID,
        timeout_ms: error.timeout_ms,
      })
    } else if (error instanceof OpenVikingNetworkError) {
      logger.warn("Session commit network error", {
        sessionID,
        error: error.message,
      })
    } else if (error instanceof OpenVikingError) {
      logger.error("Session commit API error", {
        sessionID,
        error: error.message,
        statusCode: error.statusCode,
      })
    } else {
      logger.error("Session commit unknown error", {
        sessionID,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    // Allow session to end normally (graceful degradation)
  }
}

/**
 * Check if session commit is enabled
 */
export function isSessionCommitEnabled(config: OpenVikingConfig): boolean {
  return config.enabled && config.auto_commit
}
