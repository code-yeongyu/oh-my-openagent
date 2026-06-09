import type { MemoryEntry } from "./types"
import { retrieveMemories } from "./memory"

/**
 * Hook that injects relevant past memories into session context.
 * Fires on chat.message to provide context from previous sessions.
 */
export const createMemoryContextInjector = () => {
  return {
    "experimental.chat.messages.transform": async (
      _input: unknown,
      output: { parts: Array<{ type: string; text?: string }> },
    ) => {
      // Extract user message from output parts
      const userMessage = output.parts
        .filter(p => p.type === "text" && p.text)
        .map(p => p.text!)
        .join(" ")

      if (!userMessage || userMessage.length < 10) return

      try {
        // Search for relevant memories
        const memories = await retrieveMemories({
          query: userMessage,
          limit: 3,
          minImportance: 1.0,
        })

        if (memories.length === 0) return

        // Format memories as context block
        const memoryBlock = memories
          .map((m, i) => {
            const entry = m.entry
            return `[Memory ${i + 1}] (${entry.memoryType}, relevance: ${(m.similarity * 100).toFixed(0)}%)\n${entry.content}`
          })
          .join("\n\n")

        // Inject into system context as a hint
        // This is appended to the first user message's text part
        const firstTextPart = output.parts.find(p => p.type === "text" && p.text)
        if (firstTextPart?.text) {
          firstTextPart.text += `\n\n<relevant-memories>\n${memoryBlock}\n</relevant-memories>`
        }
      } catch {
        // Silent fail — memory retrieval is non-critical
      }
    },
  }
}
