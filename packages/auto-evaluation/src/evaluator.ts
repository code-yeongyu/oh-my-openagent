import type { SessionEvaluation, EvaluationCriteria, SessionMetrics } from "./types"
import { DEFAULT_CRITERIA } from "./types"
import { getEvaluationDb } from "./storage"

export function calculateOverallScore(
  scores: {
    completionScore: number
    efficiencyScore: number
    qualityScore: number
    toolUsageScore: number
  },
  criteria: EvaluationCriteria = DEFAULT_CRITERIA,
): number {
  const overall =
    scores.completionScore * criteria.completionWeight +
    scores.efficiencyScore * criteria.efficiencyWeight +
    scores.qualityScore * criteria.qualityWeight +
    scores.toolUsageScore * criteria.toolUsageWeight

  return Math.round(overall * 100) / 100
}

export function evaluateSession(
  sessionId: string,
  agentName: string,
  metrics: SessionMetrics,
  options: {
    category?: string
    taskDescription?: string
    criteria?: EvaluationCriteria
    feedback?: string
  } = {},
): SessionEvaluation {
  const criteria = options.criteria ?? DEFAULT_CRITERIA

  // Calculate completion score based on todos and user satisfaction
  let completionScore = 50 // Base score
  if (metrics.todosTotal > 0) {
    completionScore = (metrics.todosCompleted / metrics.todosTotal) * 100
  }
  if (metrics.userSatisfaction !== undefined) {
    completionScore = completionScore * 0.7 + metrics.userSatisfaction * 0.3
  }
  completionScore = Math.min(100, Math.max(0, completionScore))

  // Calculate efficiency score based on duration and retries
  let efficiencyScore = 80 // Base score
  if (metrics.durationMs > 0) {
    // Penalize long durations (assuming 5 minutes is ideal)
    const idealDuration = 5 * 60 * 1000 // 5 minutes in ms
    const durationRatio = metrics.durationMs / idealDuration
    if (durationRatio > 1) {
      efficiencyScore -= Math.min(40, (durationRatio - 1) * 20)
    }
  }
  // Penalize retries
  efficiencyScore -= Math.min(30, metrics.retryCount * 10)
  efficiencyScore = Math.min(100, Math.max(0, efficiencyScore))

  // Calculate quality score based on errors
  let qualityScore = 90 // Base score
  qualityScore -= Math.min(50, metrics.errorCount * 10)
  if (metrics.failedToolCalls > 0 && metrics.toolCallsCount > 0) {
    const failureRate = metrics.failedToolCalls / metrics.toolCallsCount
    qualityScore -= failureRate * 30
  }
  qualityScore = Math.min(100, Math.max(0, qualityScore))

  // Calculate tool usage score
  let toolUsageScore = 70 // Base score
  if (metrics.toolCallsCount > 0) {
    const successRate = metrics.successfulToolCalls / metrics.toolCallsCount
    toolUsageScore = 50 + successRate * 50
  }
  // Penalize excessive tool calls (possible inefficiency)
  if (metrics.toolCallsCount > 50) {
    toolUsageScore -= Math.min(20, (metrics.toolCallsCount - 50) * 0.5)
  }
  toolUsageScore = Math.min(100, Math.max(0, toolUsageScore))

  const overallScore = calculateOverallScore(
    { completionScore, efficiencyScore, qualityScore, toolUsageScore },
    criteria,
  )

  // Determine completion status
  let completionStatus: SessionEvaluation["completionStatus"] = "unknown"
  if (completionScore >= 90) {
    completionStatus = "completed"
  } else if (completionScore >= 60) {
    completionStatus = "partial"
  } else if (metrics.errorCount > 5 || metrics.failedToolCalls > metrics.successfulToolCalls) {
    completionStatus = "failed"
  } else if (metrics.todosCompleted === 0 && metrics.todosTotal > 0) {
    completionStatus = "aborted"
  }

  return {
    id: crypto.randomUUID(),
    sessionId,
    agentName,
    category: options.category,
    taskDescription: options.taskDescription,
    completionScore: Math.round(completionScore * 100) / 100,
    efficiencyScore: Math.round(efficiencyScore * 100) / 100,
    qualityScore: Math.round(qualityScore * 100) / 100,
    toolUsageScore: Math.round(toolUsageScore * 100) / 100,
    overallScore,
    toolCallsCount: metrics.toolCallsCount,
    successfulToolCalls: metrics.successfulToolCalls,
    failedToolCalls: metrics.failedToolCalls,
    durationMs: metrics.durationMs,
    tokenUsage: metrics.tokenUsage,
    errorCount: metrics.errorCount,
    retryCount: metrics.retryCount,
    completionStatus,
    feedback: options.feedback,
    evaluatedAt: new Date(),
  }
}

export function storeEvaluation(evaluation: SessionEvaluation): void {
  const db = getEvaluationDb()

  db.run(
    `INSERT INTO evaluations (
      id, session_id, agent_name, category, task_description,
      completion_score, efficiency_score, quality_score, tool_usage_score, overall_score,
      tool_calls_count, successful_tool_calls, failed_tool_calls,
      duration_ms, token_usage, error_count, retry_count,
      completion_status, feedback, evaluated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      evaluation.id,
      evaluation.sessionId,
      evaluation.agentName,
      evaluation.category ?? null,
      evaluation.taskDescription ?? null,
      evaluation.completionScore,
      evaluation.efficiencyScore,
      evaluation.qualityScore,
      evaluation.toolUsageScore,
      evaluation.overallScore,
      evaluation.toolCallsCount,
      evaluation.successfulToolCalls,
      evaluation.failedToolCalls,
      evaluation.durationMs ?? null,
      evaluation.tokenUsage ?? null,
      evaluation.errorCount,
      evaluation.retryCount,
      evaluation.completionStatus,
      evaluation.feedback ?? null,
      evaluation.evaluatedAt.getTime(),
    ],
  )
}

export function getAgentScore(agentName: string): {
  averageScore: number
  totalEvaluations: number
  recentTrend: "improving" | "declining" | "stable"
} {
  const db = getEvaluationDb()

  const result = db.query(
    `SELECT 
      AVG(overall_score) as avg_score,
      COUNT(*) as total
    FROM evaluations 
    WHERE agent_name = ?`,
  ).get(agentName) as { avg_score: number | null; total: number }

  if (result.total === 0) {
    return { averageScore: 0, totalEvaluations: 0, recentTrend: "stable" }
  }

  // Get recent trend (last 5 vs previous 5)
  const recent = db.query(
    `SELECT overall_score FROM evaluations 
     WHERE agent_name = ? 
     ORDER BY evaluated_at DESC 
     LIMIT 5`,
  ).all(agentName) as Array<{ overall_score: number }>

  const previous = db.query(
    `SELECT overall_score FROM evaluations 
     WHERE agent_name = ? 
     ORDER BY evaluated_at DESC 
     LIMIT 5 OFFSET 5`,
  ).all(agentName) as Array<{ overall_score: number }>

  let recentTrend: "improving" | "declining" | "stable" = "stable"

  if (recent.length >= 3 && previous.length >= 3) {
    const recentAvg = recent.reduce((sum, r) => sum + r.overall_score, 0) / recent.length
    const previousAvg = previous.reduce((sum, r) => sum + r.overall_score, 0) / previous.length

    if (recentAvg > previousAvg + 5) {
      recentTrend = "improving"
    } else if (recentAvg < previousAvg - 5) {
      recentTrend = "declining"
    }
  }

  return {
    averageScore: Math.round((result.avg_score ?? 0) * 100) / 100,
    totalEvaluations: result.total,
    recentTrend,
  }
}

export function getBestAgentForCategory(category: string): {
  agentName: string
  averageScore: number
} | null {
  const db = getEvaluationDb()

  const result = db.query(
    `SELECT 
      agent_name,
      AVG(overall_score) as avg_score
    FROM evaluations 
    WHERE category = ?
    GROUP BY agent_name
    ORDER BY avg_score DESC
    LIMIT 1`,
  ).get(category) as { agent_name: string; avg_score: number } | null

  if (!result) return null

  return {
    agentName: result.agent_name,
    averageScore: Math.round(result.avg_score * 100) / 100,
  }
}

export function getEvaluationStats(): {
  totalEvaluations: number
  averageOverallScore: number
  byAgent: Record<string, { count: number; avgScore: number }>
  byCategory: Record<string, { count: number; avgScore: number }>
} {
  const db = getEvaluationDb()

  const totalResult = db.query(`SELECT COUNT(*) as count, AVG(overall_score) as avg FROM evaluations`).get() as {
    count: number
    avg: number | null
  }

  const agentResults = db.query(
    `SELECT agent_name, COUNT(*) as count, AVG(overall_score) as avg_score 
     FROM evaluations 
     GROUP BY agent_name`,
  ).all() as Array<{ agent_name: string; count: number; avg_score: number }>

  const categoryResults = db.query(
    `SELECT category, COUNT(*) as count, AVG(overall_score) as avg_score 
     FROM evaluations 
     WHERE category IS NOT NULL
     GROUP BY category`,
  ).all() as Array<{ category: string; count: number; avg_score: number }>

  const byAgent: Record<string, { count: number; avgScore: number }> = {}
  for (const row of agentResults) {
    byAgent[row.agent_name] = {
      count: row.count,
      avgScore: Math.round(row.avg_score * 100) / 100,
    }
  }

  const byCategory: Record<string, { count: number; avgScore: number }> = {}
  for (const row of categoryResults) {
    byCategory[row.category] = {
      count: row.count,
      avgScore: Math.round(row.avg_score * 100) / 100,
    }
  }

  return {
    totalEvaluations: totalResult.count,
    averageOverallScore: Math.round((totalResult.avg ?? 0) * 100) / 100,
    byAgent,
    byCategory,
  }
}

export function clearAllEvaluations(): void {
  const db = getEvaluationDb()
  db.run(`DELETE FROM evaluations`)
}
