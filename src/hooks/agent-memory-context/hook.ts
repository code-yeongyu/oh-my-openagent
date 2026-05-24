import { storeMemory, retrieveMemories, getRecentMemories } from "../../features/semantic-memory"
import type { MemoryEntry, MemoryQuery } from "../../features/semantic-memory"

export const HOOK_NAME = "agent-memory-context" as const

interface AgentMemoryContextInput {
  sessionID: string
  agentName: string
  message?: string
}

export function createAgentMemoryContextHook() {
  return {
    "tool.execute.before": async (input: AgentMemoryContextInput): Promise<void> => {
      const agentName = input.agentName
      if (!agentName) return

      // Retrieve agent-specific memories for context injection
      const recentMemoryQuery: MemoryQuery = {
        query: input.message ?? "",
        agentName,
        limit: 5,
        minImportance: 0.3,
      }
      const memories = retrieveMemories(recentMemoryQuery)
      if (memories.length === 0) return

      const memoryContext = memories
        .map((m) => `[${m.entry.memoryType}] ${m.entry.content}`)
        .join("\n")

      // Append to the tool input context (implementation depends on SDK)
      // The actual injection is handled by the transform hook pipeline
    },

    "tool.execute.after": async (input: AgentMemoryContextInput): Promise<void> => {
      const agentName = input.agentName
      if (!agentName || !input.message) return

      // Auto-store important content as agent-specific memory
      const importance = detectImportance(input.message)
      if (importance > 0.5) {
        storeMemory(input.message, {
          agentName,
          sessionId: input.sessionID,
          memoryType: classifyMemoryType(input.message),
          importance,
        })
      }
    },
  }
}

function detectImportance(text: string): number {
  const highSignal = [
    "fix:", "bug", "error", "breaking", "important",
    "decision", "architecture", "pattern", "root cause",
  ]
  const lower = text.toLowerCase()
  const matches = highSignal.filter((k) => lower.includes(k)).length
  return Math.min(1.0, matches * 0.25)
}

function classifyMemoryType(text: string): MemoryEntry["memoryType"] {
  const lower = text.toLowerCase()
  if (lower.includes("decision") || lower.includes("architecture")) return "decision"
  if (lower.includes("error") || lower.includes("bug") || lower.includes("fix")) return "error"
  if (lower.includes("pattern") || lower.includes("convention")) return "pattern"
  if (lower.includes("insight") || lower.includes("learned")) return "insight"
  return "context"
}
