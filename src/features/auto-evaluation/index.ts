// createAutoEvaluationHook lives in src/hooks/auto-evaluation.ts (session hook)
export type { EvaluationEntry, EvaluationMetrics, AgentScore } from "./types"
export {
  recordEvaluation,
  getAgentScore,
  getEvaluationMetrics,
  getRecentEvaluations,
  clearEvaluations,
} from "./evaluator"
export { getEvaluationDb, closeEvaluationDb } from "./storage"
