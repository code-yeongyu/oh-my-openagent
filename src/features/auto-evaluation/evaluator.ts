import { getEvaluationDb } from "./storage"
import type { EvaluationEntry, EvaluationMetrics, AgentScore } from "./types"

export function recordEvaluation(
  sessionId: string,
  agentName: string,
  metrics: {
    completionScore: number
    qualityScore: number
    efficiencyScore: number
    errorCount: number
    toolCallCount: number
    durationMs: number
    todosCompleted: number
    todosTotal: number
    category?: string
    taskDescription?: string
    feedback?: string
  },
): EvaluationEntry {
  const db = getEvaluationDb()
  const id = crypto.randomUUID()
  const now = Date.now()

  db.run(
    `INSERT INTO evaluations (
      id, session_id, agent_name, category, task_description,
      completion_score, quality_score, efficiency_score,
      error_count, tool_call_count, duration_ms,
      todos_completed, todos_total, feedback, evaluated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      sessionId,
      agentName,
      metrics.category ?? null,
      metrics.taskDescription ?? null,
      metrics.completionScore,
      metrics.qualityScore,
      metrics.efficiencyScore,
      metrics.errorCount,
      metrics.toolCallCount,
      metrics.durationMs,
      metrics.todosCompleted,
      metrics.todosTotal,
      metrics.feedback ?? null,
      now,
    ],
  )

  return {
    id,
    sessionId,
    agentName,
    category: metrics.category,
    taskDescription: metrics.taskDescription,
    completionScore: metrics.completionScore,
    qualityScore: metrics.qualityScore,
    efficiencyScore: metrics.efficiencyScore,
    errorCount: metrics.errorCount,
    toolCallCount: metrics.toolCallCount,
    durationMs: metrics.durationMs,
    todosCompleted: metrics.todosCompleted,
    todosTotal: metrics.todosTotal,
    feedback: metrics.feedback,
    evaluatedAt: new Date(now),
  }
}

export function getAgentScore(agentName: string): AgentScore | null {
  const db = getEvaluationDb()

  const metrics = getEvaluationMetrics(agentName)
  if (metrics.totalEvaluations === 0) return null

  // Calculate overall score (weighted average)
  const overallScore =
    metrics.avgCompletionScore * 0.4 +
    metrics.avgQualityScore * 0.35 +
    metrics.avgEfficiencyScore * 0.25

  // Determine trend by comparing recent vs older evaluations
  const recentEvals = db
    .query(
      `SELECT AVG(completion_score) as avg FROM evaluations
       WHERE agent_name = ? AND evaluated_at > ?`,
    )
    .get(agentName, Date.now() - 7 * 24 * 60 * 60 * 1000) as { avg: number | null }

  const olderEvals = db
    .query(
      `SELECT AVG(completion_score) as avg FROM evaluations
       WHERE agent_name = ? AND evaluated_at <= ? AND evaluated_at > ?`,
    )
    .get(
      agentName,
      Date.now() - 7 * 24 * 60 * 60 * 1000,
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ) as { avg: number | null }

  let trend: "improving" | "stable" | "declining" = "stable"
  if (recentEvals.avg && olderEvals.avg) {
    const diff = recentEvals.avg - olderEvals.avg
    if (diff > 5) trend = "improving"
    else if (diff < -5) trend = "declining"
  }

  // Generate recommendation
  let recommendation = ""
  if (overallScore >= 85) {
    recommendation = `Excellent performance. ${agentName} is highly effective for its assigned tasks.`
  } else if (overallScore >= 70) {
    recommendation = `Good performance. Consider optimizing task descriptions for better results.`
  } else if (overallScore >= 50) {
    recommendation = `Average performance. Review error patterns and consider additional context.`
  } else {
    recommendation = `Below average. Consider reassigning tasks or providing more detailed instructions.`
  }

  return {
    agentName,
    overallScore: Math.round(overallScore),
    metrics,
    trend,
    recommendation,
  }
}

export function getEvaluationMetrics(agentName?: string): EvaluationMetrics {
  const db = getEvaluationDb()

  let sql = `SELECT
    AVG(completion_score) as avg_completion,
    AVG(quality_score) as avg_quality,
    AVG(efficiency_score) as avg_efficiency,
    COUNT(*) as total,
    AVG(error_count) as avg_errors,
    AVG(tool_call_count) as avg_tools,
    AVG(duration_ms) as avg_duration,
    AVG(CAST(todos_completed AS REAL) / NULLIF(todos_total, 0)) as todo_rate
    FROM evaluations`

  const params: string[] = []

  if (agentName) {
    sql += ` WHERE agent_name = ?`
    params.push(agentName)
  }

  const result = db.query(sql).get(...params) as {
    avg_completion: number | null
    avg_quality: number | null
    avg_efficiency: number | null
    total: number
    avg_errors: number | null
    avg_tools: number | null
    avg_duration: number | null
    todo_rate: number | null
  }

  return {
    avgCompletionScore: Math.round((result.avg_completion ?? 0) * 10) / 10,
    avgQualityScore: Math.round((result.avg_quality ?? 0) * 10) / 10,
    avgEfficiencyScore: Math.round((result.avg_efficiency ?? 0) * 10) / 10,
    totalEvaluations: result.total,
    errorRate: Math.round((result.avg_errors ?? 0) * 10) / 10,
    avgToolCalls: Math.round((result.avg_tools ?? 0) * 10) / 10,
    avgDurationMs: Math.round(result.avg_duration ?? 0),
    todoCompletionRate: Math.round((result.todo_rate ?? 0) * 100) / 100,
  }
}

export function getRecentEvaluations(
  options: {
    agentName?: string
    category?: string
    limit?: number
    days?: number
  } = {},
): EvaluationEntry[] {
  const db = getEvaluationDb()

  let sql = `SELECT * FROM evaluations WHERE 1=1`
  const params: (string | number)[] = []

  if (options.agentName) {
    sql += ` AND agent_name = ?`
    params.push(options.agentName)
  }

  if (options.category) {
    sql += ` AND category = ?`
    params.push(options.category)
  }

  if (options.days) {
    sql += ` AND evaluated_at >= ?`
    params.push(Date.now() - options.days * 24 * 60 * 60 * 1000)
  }

  sql += ` ORDER BY evaluated_at DESC LIMIT ?`
  params.push(options.limit ?? 10)

  const stmt = db.query(sql)
  const rows = stmt.all(...params) as Array<{
    id: string
    session_id: string
    agent_name: string
    category: string | null
    task_description: string | null
    completion_score: number
    quality_score: number
    efficiency_score: number
    error_count: number
    tool_call_count: number
    duration_ms: number
    todos_completed: number
    todos_total: number
    feedback: string | null
    evaluated_at: number
  }>

  return rows.map(row => ({
    id: row.id,
    sessionId: row.session_id,
    agentName: row.agent_name,
    category: row.category ?? undefined,
    taskDescription: row.task_description ?? undefined,
    completionScore: row.completion_score,
    qualityScore: row.quality_score,
    efficiencyScore: row.efficiency_score,
    errorCount: row.error_count,
    toolCallCount: row.tool_call_count,
    durationMs: row.duration_ms,
    todosCompleted: row.todos_completed,
    todosTotal: row.todos_total,
    feedback: row.feedback ?? undefined,
    evaluatedAt: new Date(row.evaluated_at),
  }))
}

export function clearEvaluations(scope: "all" | { agentName?: string; sessionId?: string } = "all"): void {
  const db = getEvaluationDb()

  if (scope === "all") {
    db.run(`DELETE FROM evaluations`)
  } else if (scope.agentName) {
    db.run(`DELETE FROM evaluations WHERE agent_name = ?`, [scope.agentName])
  } else if (scope.sessionId) {
    db.run(`DELETE FROM evaluations WHERE session_id = ?`, [scope.sessionId])
  }
}
