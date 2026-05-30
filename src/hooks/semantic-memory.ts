import { storeMemory } from "../features/semantic-memory"

export const createSemanticMemoryHook = () => {
  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown },
    ) => {
      // Only store memory for important tools
      const importantTools = ["delegate", "task", "skill", "write", "edit"]
      if (!importantTools.includes(input.tool)) {
        return
      }

      const sessionId = input.sessionID
      const toolName = input.tool
      const toolOutput = output.output?.toString() ?? ""

      // Store successful tool executions as memories
      if (!toolOutput.includes("Error:")) {
        storeMemory(`Tool ${toolName} executed successfully`, {
          sessionId,
          memoryType: "context",
          importance: 1.5,
        })
      }

      // Store errors as memories for future reference
      if (toolOutput.includes("Error:")) {
        storeMemory(`Error in tool ${toolName}: ${toolOutput.substring(0, 200)}`, {
          sessionId,
          memoryType: "error",
          importance: 2.0,
        })
      }
    },
  }
}
