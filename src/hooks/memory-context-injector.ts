import type { HookDefinition } from "../../plugin/hooks"
import { storeMemory } from "@oh-my-opencode/semantic-memory"

export const createMemoryContextInjectorHook = (): HookDefinition => {
  return {
    name: "memory-context-injector",
    hook: "experimental.chat.system.transform",
    priority: 30,
    handler: async (systemMessage, context) => {
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
