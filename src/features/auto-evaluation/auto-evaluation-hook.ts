import { recordEvaluation } from "./evaluator"

export function createAutoEvaluationHook() {
  return {
    name: "auto-evaluation",
    priority: 80,
    executeAfterTool: async (context: any, _toolCall: any, toolResult: any) => {
      // Only evaluate at the end of a session or periodically
      const session = context.session
      if (!session) return

      // Simple heuristic: evaluate every 5 tool calls
      const toolCallCount = session.toolCallCount ?? 0
      if (toolCallCount % 5 !== 0) return

      const agentName = session.agentName ?? "unknown"
      const sessionId = session.id

      // Calculate basic metrics
      const durationMs = Date.now() - (session.startTime ?? Date.now())
      const errorCount = session.errorCount ?? 0
      const todosCompleted = session.todosCompleted ?? 0
      const todosTotal = session.todosTotal ?? 1

      // Calculate scores based on heuristics
      const completionScore = Math.min(100, (todosCompleted / todosTotal) * 100)
      const qualityScore = Math.max(0, 100 - errorCount * 10)
      const efficiencyScore = Math.max(0, 100 - (toolCallCount / 10) * 5)

      recordEvaluation(sessionId, agentName, {
        completionScore,
        qualityScore,
        efficiencyScore,
        errorCount,
        toolCallCount,
        durationMs,
        todosCompleted,
        todosTotal,
        category: session.category,
        taskDescription: session.currentTask,
      })
    },
  }
}
