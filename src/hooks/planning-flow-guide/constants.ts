export const HOOK_NAME = "planning-flow-guide"

/**
 * Planning flow phases in recommended order.
 * Metis (analysis) → Prometheus (planning) → Momus (review)
 */
export const PLANNING_FLOW_ORDER = ["metis", "prometheus", "momus"] as const

export type PlanningPhase = (typeof PLANNING_FLOW_ORDER)[number]

/**
 * Agent name patterns that map to planning phases.
 */
export const PHASE_AGENT_PATTERNS: Record<PlanningPhase, RegExp> = {
  metis: /metis|plan.?consultant/i,
  prometheus: /prometheus|planner/i,
  momus: /momus|plan.?reviewer/i,
}

/**
 * Warning messages for non-standard flow transitions.
 */
export const FLOW_WARNINGS: Record<string, string> = {
  "prometheus-without-metis":
    "⚠️ Planning Flow: Prometheus called without prior Metis consultation. Consider using Metis first to identify hidden requirements and AI failure points.",
  "momus-without-prometheus":
    "⚠️ Planning Flow: Momus called without a Prometheus plan. Momus reviews plans - ensure a plan exists first.",
  "momus-without-metis":
    "⚠️ Planning Flow: Full planning cycle (Metis → Prometheus → Momus) recommended for complex features.",
}

/**
 * Guidance messages for each phase.
 */
export const PHASE_GUIDANCE: Record<PlanningPhase, string> = {
  metis:
    "💡 Metis (Plan Consultant) analyzes requests to identify hidden intentions, ambiguities, and AI failure points before planning.",
  prometheus:
    "💡 Prometheus (Planner) creates detailed work plans with task breakdowns and acceptance criteria.",
  momus:
    "💡 Momus (Plan Reviewer) evaluates plans against rigor standards. If REJECTED, return to Prometheus for revision.",
}
