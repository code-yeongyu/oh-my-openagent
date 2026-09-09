import type { Goal, GoalDeliverable } from "./types"

const DELIVERABLE_LINE_PATTERN = /^\s*(?:[-*]|\d+[.)])\s+(.+?)\s*$/

export function deriveDeliverables(objective: string): GoalDeliverable[] {
  const items: GoalDeliverable[] = []
  for (const line of objective.split("\n")) {
    const match = line.match(DELIVERABLE_LINE_PATTERN)
    const text = match?.[1]
    if (text === undefined || text.length === 0) continue
    items.push({ text })
  }
  return items.length > 0 ? items : [{ text: objective }]
}

export function buildSessionGoalAnchor(goal: Goal): string {
  const originalObjective = goal.originalObjective ?? goal.objective
  const lines = [
    "<session-goal>",
    "<original_objective>",
    escapeXmlText(originalObjective),
    "</original_objective>",
    "<current_objective>",
    escapeXmlText(goal.objective),
    "</current_objective>",
    `status: ${goal.status}`,
  ]
  if (goal.deliverables !== undefined && goal.deliverables.length > 0) {
    lines.push("<pending_deliverables>")
    for (const deliverable of goal.deliverables) {
      lines.push(`- ${escapeXmlText(deliverable.text)}`)
    }
    lines.push("</pending_deliverables>")
  }
  lines.push("</session-goal>")
  return lines.join("\n")
}

function escapeXmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}
