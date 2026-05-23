import { recordEvaluation, getEvaluationMetrics } from "../features/auto-evaluation"

export const createAutoEvaluationHook = () => {
  return async ({ event }: { event: { type: string; properties?: unknown } }) => {
    // Only evaluate on session completion events
    if (event.type !== "session.idle" && event.type !== "session.deleted" && event.type !== "session.error") {
      return
    }

    const props = event.properties as Record<string, unknown> | undefined
    const sessionId = props?.sessionID as string ?? "unknown"
    const agentName = props?.agent as string ?? "unknown"
    const category = props?.category as string | undefined

    // Gather session metrics from context
    const toolCallsCount = props?.toolCallsCount as number ?? 0
    const errorCount = props?.errorCount as number ?? 0
    const durationMs = props?.durationMs as number ?? 0
    const todosCompleted = props?.todosCompleted as number ?? 0
    const todosTotal = props?.todosTotal as number ?? 1

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
      taskDescription: props?.currentTask as string | undefined,
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
  }
}
