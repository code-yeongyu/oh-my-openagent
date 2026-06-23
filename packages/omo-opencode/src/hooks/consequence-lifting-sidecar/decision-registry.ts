import type { ConclusionRole } from "./types"

const DECISION_PREFIXES = ["activate_", "deploy_", "implement_", "select_", "choose_", "approve_", "launch_"]
const MITIGATION_PREFIXES = ["mandatory_", "continuous_", "monitoring_"]
const COMPENSATION_PREFIXES = ["compensation_", "compensate_"]
const GUARDRAIL_PREFIXES = ["guardrail_", "mandatory_operational_", "mandatory_enhanced_", "mandatory_emergency_"]
const TRIGGER_PREFIXES = ["mandatory_auto_", "auto_", "stop_trigger_", "rollback_trigger_"]
const REPAIR_PREFIXES = ["repair_", "mandatory_repair_"]
const STRUCTURAL_CONSTRAINT_PREFIXES = ["constraint_", "full_inspection_requires_", "max_", "incompatible_"]
const INFO_EVENT_PREFIXES = ["info_event_", "earnings_", "call_", "hearing_", "deadline_"]
const CONDITION_PREFIXES = ["require_", "ensure_", "verify_"]
const OVERRIDE_PREFIXES = ["necessity_override", "override_", "emergency_override", "stato_di_necessita"]
const NEGATIVE_PREFIXES = ["-"]

function hasPrefix(value: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix))
}

function stripNegation(conclusion: string): string {
  return NEGATIVE_PREFIXES.some((prefix) => conclusion.startsWith(prefix))
    ? conclusion.slice(1)
    : conclusion
}

export function classifyConclusion(conclusion: string, premiseTags: string[]): ConclusionRole {
  if (premiseTags.includes("role:decision")) return "decision"
  if (hasPrefix(conclusion, DECISION_PREFIXES)) return "decision"
  if (hasPrefix(conclusion, COMPENSATION_PREFIXES) || premiseTags.includes("role:compensation")) return "compensation"
  if (hasPrefix(conclusion, MITIGATION_PREFIXES)) return "mitigation"
  if (hasPrefix(conclusion, GUARDRAIL_PREFIXES) || premiseTags.includes("role:guardrail")) return "guardrail"
  if (hasPrefix(conclusion, TRIGGER_PREFIXES) || premiseTags.includes("role:trigger")) return "trigger"
  if (hasPrefix(conclusion, REPAIR_PREFIXES) || premiseTags.includes("role:repair")) return "repair_obligation"
  if (hasPrefix(conclusion, STRUCTURAL_CONSTRAINT_PREFIXES) || premiseTags.some((tag) => tag.startsWith("constraint:")) || premiseTags.includes("role:structural_constraint")) return "structural_constraint"
  if (hasPrefix(conclusion, INFO_EVENT_PREFIXES) || premiseTags.includes("role:info_event")) return "info_event"
  if (hasPrefix(conclusion, CONDITION_PREFIXES)) return "condition"
  if (OVERRIDE_PREFIXES.some((prefix) => conclusion.startsWith(prefix) || conclusion === prefix)) return "override"

  if (NEGATIVE_PREFIXES.some((prefix) => conclusion.startsWith(prefix))) {
    const stripped = stripNegation(conclusion)
    if (hasPrefix(stripped, DECISION_PREFIXES)) return "consequence"
    if (hasPrefix(stripped, COMPENSATION_PREFIXES)) return "compensation"
    if (hasPrefix(stripped, MITIGATION_PREFIXES)) return "mitigation"
    if (hasPrefix(stripped, GUARDRAIL_PREFIXES)) return "guardrail"
    if (hasPrefix(stripped, TRIGGER_PREFIXES)) return "trigger"
    if (hasPrefix(stripped, REPAIR_PREFIXES)) return "repair_obligation"
    if (hasPrefix(stripped, STRUCTURAL_CONSTRAINT_PREFIXES)) return "structural_constraint"
    if (hasPrefix(stripped, INFO_EVENT_PREFIXES)) return "info_event"
    if (hasPrefix(stripped, CONDITION_PREFIXES)) return "condition"
  }

  return "consequence"
}

export function identifyDecisions(conclusions: Map<string, { status: string; tags?: string[] }>): string[] {
  return [...conclusions.entries()]
    .filter(([conclusion, state]) => {
      if (classifyConclusion(conclusion, state.tags ?? []) !== "decision") return false
      return state.status !== "Rejected"
    })
    .map(([conclusion]) => conclusion)
}
