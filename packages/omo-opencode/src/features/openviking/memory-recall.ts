import type { Message, Part } from "@opencode-ai/sdk"
import { OpenVikingClient } from "./client"
import type { Memory } from "./types"
import type { OpenVikingConfig, MemoryType } from "../../config/schema/openviking"
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
 * Memory recall hook configuration
 */
export interface MemoryRecallHookConfig {
  /** OpenViking configuration */
  openviking: OpenVikingConfig
  
  /** Logger instance */
  logger?: Logger
}

/**
 * Message transform hook input
 */
interface MessageTransformInput {
  sessionID?: string
  agent?: string
  model?: { providerID: string; modelID: string }
}

/**
 * Message transform hook output
 */
interface MessageTransformOutput {
  messages: MessageWithParts[]
}

/**
 * Message with parts
 */
interface MessageWithParts {
  info: Message
  parts: Part[]
}

/**
 * Create memory recall hook for experimental.chat.messages.transform
 * 
 * This hook automatically recalls relevant memories from OpenViking
 * before each AI call and injects them into the conversation context.
 * 
 * @param config - Hook configuration
 * @returns Hook object with experimental.chat.messages.transform method
 */
export function createMemoryRecallHook(config: MemoryRecallHookConfig) {
  const { openviking, logger = defaultLogger } = config

  // Create OpenViking client
  const client = new OpenVikingClient({
    url: openviking.url,
    api_key: openviking.api_key,
  })

  return {
    "experimental.chat.messages.transform": async (
      _input: MessageTransformInput,
      output: MessageTransformOutput
    ): Promise<void> => {
      // Skip if auto_recall is disabled
      if (!openviking.auto_recall) {
        return
      }

      // Skip if no messages
      if (output.messages.length === 0) {
        return
      }

      // Find the last user message
      const lastUserMessage = findLastUserMessage(output.messages)
      if (!lastUserMessage) {
        logger.warn("No user message found, skipping memory recall")
        return
      }

      // Extract query from last user message
      const query = extractQueryFromMessage(lastUserMessage)
      if (!query) {
        logger.warn("No query text found in last user message, skipping memory recall")
        return
      }

      try {
        // Recall memories from OpenViking
        logger.info("Recalling memories", { query: query.substring(0, 100) })
        
        const response = await client.recall(
          query,
          openviking.memory_types,
          openviking.max_memories
        )

        // Skip if no memories found
        if (response.memories.length === 0) {
          logger.info("No memories found", { query })
          return
        }

        logger.info("Memories recalled", {
          count: response.memories.length,
          duration_ms: response.duration_ms,
        })

        // Format memories for injection
        const formattedMemories = formatMemories(response.memories)

        // Inject memories into the last user message
        injectMemoriesIntoMessage(lastUserMessage, formattedMemories)

        logger.info("Memories injected", {
          sessionID: _input.sessionID,
          memoryCount: response.memories.length,
        })
      } catch (error) {
        // Handle errors gracefully
        if (error instanceof OpenVikingTimeoutError) {
          logger.warn("Memory recall timed out, skipping injection", {
            timeout_ms: error.timeout_ms,
          })
        } else if (error instanceof OpenVikingNetworkError) {
          logger.warn("Memory recall network error, skipping injection", {
            error: error.message,
          })
        } else if (error instanceof OpenVikingError) {
          logger.error("Memory recall API error, skipping injection", {
            error: error.message,
            statusCode: error.statusCode,
          })
        } else {
          logger.error("Memory recall unknown error, skipping injection", {
            error: error instanceof Error ? error.message : String(error),
          })
        }

        // Continue without memory injection (graceful degradation)
      }
    },
  }
}

/**
 * Find the last user message in the message list
 */
function findLastUserMessage(messages: MessageWithParts[]): MessageWithParts | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.info.role === "user") {
      // Check if it's a real user message (not synthetic)
      const hasRealTextPart = message.parts.some(
        (part) => part.type === "text" && typeof part.text === "string" && part.text.length > 0
      )
      if (hasRealTextPart) {
        return message
      }
    }
  }
  return null
}

/**
 * Extract query text from a user message
 */
function extractQueryFromMessage(message: MessageWithParts): string | null {
  // Find the first text part
  const textPart = message.parts.find(
    (part) => part.type === "text" && typeof part.text === "string"
  )

  if (!textPart || typeof textPart.text !== "string") {
    return null
  }

  // Return the text content (truncated if too long)
  const text = textPart.text.trim()
  return text.length > 500 ? text.substring(0, 500) : text
}

/**
 * Format memories for injection into conversation
 */
function formatMemories(memories: Memory[]): string {
  const sections: string[] = []

  for (const memory of memories) {
    const typeLabel = memory.type.charAt(0).toUpperCase() + memory.type.slice(1)
    sections.push(`[${typeLabel}] ${memory.content}`)
  }

  return sections.join("\n\n")
}

/**
 * Inject formatted memories into a user message
 */
function injectMemoriesIntoMessage(message: MessageWithParts, formattedMemories: string): void {
  // Find the first text part
  const textPartIndex = message.parts.findIndex(
    (part) => part.type === "text" && typeof part.text === "string"
  )

  if (textPartIndex === -1) {
    return
  }

  // Create a synthetic part for memories
  const memoryPart: Part = {
    id: `prt_openviking_memories_${message.info.id}_${Date.now()}`,
    messageID: message.info.id,
    sessionID: message.info.sessionID,
    type: "text",
    text: `<openviking-memories>\n${formattedMemories}\n</openviking-memories>\n\n`,
    synthetic: true,
  } as Part

  // Insert the memory part before the original text part
  message.parts.splice(textPartIndex, 0, memoryPart)
}

/**
 * Check if memory recall is enabled
 */
export function isMemoryRecallEnabled(config: OpenVikingConfig): boolean {
  return config.enabled && config.auto_recall
}
