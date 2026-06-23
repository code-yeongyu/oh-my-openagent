import type { CandidateAction } from "../types"
import { isRecord } from "./mcp-payload-extractor"

const INTERNAL_ORCHESTRATION_SUBAGENTS = new Set(["explore", "librarian", "metis", "momus", "oracle"])

export interface PolicyFact {
  formula: string
  kind: "ordinary"
}

export function buildPolicyFacts(candidate: CandidateAction): PolicyFact[] {
  const facts: PolicyFact[] = []
  const args = candidate.args

  if (!isTaskAction(candidate)) {
    facts.push({ formula: "non_task_action(current)", kind: "ordinary" })
    return facts
  }

  facts.push({ formula: "task_action(current)", kind: "ordinary" })
  const isInternal = isInternalOrchestrationTask(candidate)
  facts.push({
    formula: isInternal ? "internal_orchestration_task(current)" : "delegated_work_task(current)",
    kind: "ordinary",
  })
  facts.push({
    formula: hasPresentValue(args, "prompt") ? "has_prompt(current)" : "missing_prompt(current)",
    kind: "ordinary",
  })
  facts.push({
    formula: hasPresentValue(args, "description") ? "has_description(current)" : "missing_description(current)",
    kind: "ordinary",
  })
  facts.push({
    formula: hasPresentArray(args, "load_skills") ? "has_load_skills(current)" : "missing_load_skills(current)",
    kind: "ordinary",
  })
  facts.push({
    formula: isInternal
      ? hasInternalTargetValue(candidate)
        ? "has_internal_target(current)"
        : "missing_internal_target(current)"
      : hasDelegatedTargetValue(candidate)
        ? "has_delegated_target(current)"
        : "missing_delegated_target(current)",
    kind: "ordinary",
  })
  return facts
}

function isTaskAction(candidate: CandidateAction): boolean {
  return candidate.tool === "task"
}

function isInternalOrchestrationTask(candidate: CandidateAction): boolean {
  const record = toRecord(candidate.args)
  if (!record) return false
  if (hasPresentValue(record, "session_id")) return true
  const subagentType = typeof record.subagent_type === "string" ? record.subagent_type.trim().toLowerCase() : undefined
  return subagentType != null && INTERNAL_ORCHESTRATION_SUBAGENTS.has(subagentType)
}

function hasInternalTargetValue(candidate: CandidateAction): boolean {
  const record = toRecord(candidate.args)
  if (!record) return false
  if (hasPresentValue(record, "session_id")) return true
  const subagentType = typeof record.subagent_type === "string" ? record.subagent_type.trim().toLowerCase() : undefined
  return subagentType != null && INTERNAL_ORCHESTRATION_SUBAGENTS.has(subagentType)
}

function hasDelegatedTargetValue(candidate: CandidateAction): boolean {
  const record = toRecord(candidate.args)
  if (!record) return false
  if (hasPresentValue(record, "category")) return true
  const subagentType = typeof record.subagent_type === "string" ? record.subagent_type.trim().toLowerCase() : undefined
  return subagentType != null && !INTERNAL_ORCHESTRATION_SUBAGENTS.has(subagentType)
}

function hasPresentValue(value: CandidateAction | Record<string, unknown>, field: string): boolean {
  const record = toRecord(value)
  if (!record) return false
  const fieldValue = record[field]
  if (typeof fieldValue === "string") return fieldValue.trim().length > 0
  return fieldValue != null
}

function hasPresentArray(value: CandidateAction | Record<string, unknown>, field: string): boolean {
  const record = toRecord(value)
  if (!record) return false
  return Array.isArray(record[field])
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? (value as Record<string, unknown>) : undefined
}
