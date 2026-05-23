import { recordEvaluation, getEvaluationMetrics } from "../features/auto-evaluation"

export const createAutoEvaluationHook = () => {
  return {
    name: "auto-evaluation",
    hook: "event",
    priority: 25,
    handler: async (event: any, context: any) => {
      // Only evaluate on session completion events
      if (event.type !== "session.completed" && event.type !== "session.error") {
        return
      }

      const sessionId = context.session?.id ?? "unknown"
      const agentName = context.agent?.name ?? "unknown"
      const category = context.agent?.category

      // Gather session metrics from context
      const toolCallsCount = context.session?.toolCallsCount ?? 0
      const errorCount = context.session?.errorCount ?? 0
      const durationMs = context.session?.durationMs ?? 0
      const todosCompleted = context.session?.todosCompleted ?? 0
      const todosTotal = context.session?.todosTotal ?? 1

      // Calculate scores based on heuristics
      const completionScore = Math.min(100, (todosCompleted / Math.max(todosTotal, 1)) * 100)
      const qualityScore = Math.max(0, 100 - errorCount * 10)
      const efficiencyScore = Math.max(0, 100 - (toolCallsCount / 10) * 5)

      recordEvaluation(sessionId, agentName, {
        completionScore,
        qualityScore,
        efficiencyScore,
        errorCount,
        toolCallCount: toolCallsCount,
        durationMs,
        todosCompleted,
        todosTotal: Math.max(todosTotal, 1),
        category,
        taskDescription: context.session?.currentTask,
      })

      // Log evaluation result
      const metrics = getEvaluationMetrics(agentName)
      console.log(`[AutoEvaluation] Session ${sessionId} evaluated:`, {
        agent: agentName,
        completion: `${completionScore}%`,
        quality: `${qualityScore}%`,
        efficiency: `${efficiencyScore}%`,
        totalEvals: metrics.totalEvaluations,
      })
    },
  }
}
