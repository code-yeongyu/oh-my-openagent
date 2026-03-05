import type { DecisionEntry, FlightPlan, CorrectionEntry } from "./readers"

function formatFlightPlanSection(plan: FlightPlan): string {
  const expectations = plan.expectations
  const completed = expectations.filter((e) => e.status === "completed").length
  const failed = expectations.filter((e) => e.status === "failed").length
  const unverified = expectations.filter((e) =>
    e.status === "planned" || e.status === "in_progress",
  ).length
  const total = expectations.length

  const lines: string[] = ["### Flight Plan"]

  if (completed === total) {
    lines.push(`✅ All ${total} expectations met.`)
  } else if (failed > 0) {
    lines.push(`⚠️ ${completed}/${total} met, ${failed} failed, ${unverified} unverified.`)
  } else if (unverified > 0) {
    lines.push(`${completed}/${total} met, ${unverified} unverified.`)
  }

  const mustFails = expectations.filter(
    (e) => e.priority === "must" && e.status === "failed",
  )
  for (const exp of mustFails) {
    lines.push(`❌ MUST: ${exp.description}`)
    if (exp.result_notes) lines.push(`   Result: ${exp.result_notes}`)
  }

  const mustUnverified = expectations.filter(
    (e) => e.priority === "must" && (e.status === "planned" || e.status === "in_progress"),
  )
  for (const exp of mustUnverified) {
    lines.push(`⚠️ MUST (unverified): ${exp.description}`)
    lines.push(`   Verify: ${exp.verification}`)
  }

  if (plan.metadata.notes) {
    lines.push(`Context: ${plan.metadata.notes}`)
  }

  return lines.join("\n")
}

function formatDecisionsSection(decisions: DecisionEntry[]): string {
  if (decisions.length === 0) return ""

  const l2 = decisions.filter((d) => d.standing_order_level === 2)
  const l3 = decisions.filter((d) => d.standing_order_level === 3)
  const promoteCandidates = decisions.filter((d) => d.promote_candidate)

  const lines: string[] = ["### Autonomous Decisions (last 24h)"]

  if (l2.length > 0) {
    lines.push(`L2 (did then reported): ${l2.length}`)
    for (const d of l2.slice(0, 5)) {
      const emoji = d.outcome === "success" ? "✅" : d.outcome === "failure" ? "❌" : "⏳"
      lines.push(`  ${emoji} ${d.action}`)
    }
    if (l2.length > 5) lines.push(`  (+${l2.length - 5} more)`)
  }

  if (l3.length > 0) {
    lines.push(`L3 (proposed): ${l3.length}`)
    for (const d of l3.slice(0, 3)) {
      lines.push(`  ⏳ ${d.action}`)
    }
  }

  if (promoteCandidates.length > 0) {
    lines.push(`🔼 ${promoteCandidates.length} promotion candidate(s)`)
  }

  return lines.join("\n")
}

function formatCorrectionsSection(corrections: CorrectionEntry[]): string {
  if (corrections.length === 0) return ""

  const lines: string[] = ["### Session-Start Corrections"]
  for (const c of corrections) {
    lines.push(`🔴 ${c.title}: ${c.rule}`)
  }

  return lines.join("\n")
}

export function formatExecutionGateBriefing(
  plan: FlightPlan | null,
  decisions: DecisionEntry[],
  corrections: CorrectionEntry[],
): string {
  const sections: string[] = ["[SYSTEM REMINDER - EXECUTION GATE]", ""]

  if (plan) {
    sections.push(formatFlightPlanSection(plan))
    sections.push("")
  }

  const decisionsSection = formatDecisionsSection(decisions)
  if (decisionsSection) {
    sections.push(decisionsSection)
    sections.push("")
  }

  const correctionsSection = formatCorrectionsSection(corrections)
  if (correctionsSection) {
    sections.push(correctionsSection)
    sections.push("")
  }

  if (sections.length <= 2) return ""

  sections.push("Verify flight plan expectations. Review autonomous decisions. Apply corrections.")

  return sections.join("\n")
}
