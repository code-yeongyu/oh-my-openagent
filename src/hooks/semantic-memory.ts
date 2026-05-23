import { storeMemory } from "../features/semantic-memory"

export const createSemanticMemoryHook = () => {
  return {
    name: "memory-context-injector",
    hook: "experimental.chat.system.transform",
    priority: 30,
    handler: async (systemMessage: any, context: any) => {
      // Only inject memory for primary agents (not subagents)
      if (context.agent?.mode !== "primary") {
        return systemMessage
      }

      const agentName = context.agent?.name ?? "unknown"
      const sessionId = context.session?.id ?? "unknown"

      // Store important context from the session
      if (context.session?.currentTask) {
        storeMemory(`Current task: ${context.session.currentTask}`, {
          agentName,
          sessionId,
          memoryType: "context",
          importance: 1.5,
        })
      }

      // Store agent decisions
      if (context.session?.lastDecision) {
        storeMemory(`Decision made: ${context.session.lastDecision}`, {
          agentName,
          sessionId,
          memoryType: "decision",
          importance: 2.0,
        })
      }

      // Store errors for future reference
      if (context.session?.lastError) {
        storeMemory(`Error encountered: ${context.session.lastError}`, {
          agentName,
          sessionId,
          memoryType: "error",
          importance: 1.8,
        })
      }

      return systemMessage
    },
  }
}
