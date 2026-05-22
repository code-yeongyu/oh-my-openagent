import type { HookDefinition } from "../../plugin/hooks"
import { evaluateSession, storeEvaluation } from "@oh-my-opencode/auto-evaluation"
import type { SessionMetrics } from "@oh-my-opencode/auto-evaluation"

export const createAutoEvaluationHook = (): HookDefinition => {
  return {
    name: "auto-evaluation",
    hook: "event",
    priority: 25,
    handler: async (event, context) => {
      // Only evaluate on session completion events
      if (event.type !== "session.completed" && event.type !== "session.error") {
        return
      }

      const sessionId = context.session?.id ?? "unknown"
      const agentName = context.agent?.name ?? "unknown"
      const category = context.agent?.category

      // Gather session metrics from context
      const metrics: SessionMetrics = {
        toolCallsCount: context.session?.toolCallsCount ?? 0,
        successfulToolCalls: context.session?.successfulToolCalls ?? 0,
        failedToolCalls: context.session?.failedToolCalls ?? 0,
        durationMs: context.session?.durationMs ?? 0,
        tokenUsage: context.session?.tokenUsage ?? 0,
        errorCount: context.session?.errorCount ?? 0,
        retryCount: context.session?.retryCount ?? 0,
        todosCompleted: context.session?.todosCompleted ?? 0,
        todosTotal: context.session?.todosTotal ?? 0,
      }

      const evaluation = evaluateSession(sessionId, agentName, metrics, {
        category,
        taskDescription: context.session?.currentTask,
      })

      storeEvaluation(evaluation)

      // Log evaluation result
      console.log(`[AutoEvaluation] Session ${sessionId} evaluated: ${evaluation.overallScore}/100 (${evaluation.completionStatus})`)
    },
  }
}
