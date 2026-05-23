import { storeMemory } from "./memory"

export function createMemoryContextInjectorHook() {
  return {
    name: "memory-context-injector",
    priority: 70,
    executeAfterTool: async (context: any, _toolCall: any, toolResult: any) => {
      // Only process successful tool executions
      if (toolResult.isError) return

      // Store important context from tool executions
      const session = context.session
      const agentName = session?.agentName ?? "unknown"
      const sessionId = session?.id

      // Store tool execution as memory if it's significant
      if (toolResult.output && toolResult.output.length > 50) {
        const content = `[${agentName}] Tool: ${toolResult.toolName}\n${toolResult.output.substring(0, 500)}`
        storeMemory(content, {
          agentName,
          sessionId,
          memoryType: "context",
          importance: 0.7,
        })
      }

      // Store errors as memory for learning
      if (toolResult.isError && toolResult.error) {
        const content = `[${agentName}] Error: ${toolResult.error}`
        storeMemory(content, {
          agentName,
          sessionId,
          memoryType: "error",
          importance: 0.9,
        })
      }
    },
  }
}
