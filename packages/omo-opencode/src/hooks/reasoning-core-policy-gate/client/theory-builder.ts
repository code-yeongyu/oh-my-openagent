import type { ReasoningCoreRequest } from "../types"
import { buildPolicyFacts } from "./policy-facts-builder"
import { isRecord } from "./mcp-payload-extractor"

export function buildTheory(request: ReasoningCoreRequest): Record<string, unknown> {
  const theoryOverride = extractTheoryOverride(request.sessionContext)
  if (theoryOverride) {
    return theoryOverride
  }

  return {
    premises: buildPolicyFacts(request.candidate),
    strict_rules: [
      {
        antecedents: ["non_task_action(current)"],
        consequent: "allow_action(current)",
        id: "policy-v1-non-task-allow",
      },
      {
        antecedents: [
          "internal_orchestration_task(current)",
          "has_prompt(current)",
          "has_description(current)",
          "has_load_skills(current)",
          "has_internal_target(current)",
        ],
        consequent: "allow_action(current)",
        id: "policy-v1-internal-task-allow",
      },
      {
        antecedents: [
          "delegated_work_task(current)",
          "has_prompt(current)",
          "has_description(current)",
          "has_load_skills(current)",
          "has_delegated_target(current)",
        ],
        consequent: "allow_action(current)",
        id: "policy-v1-delegated-task-allow",
      },
      {
        antecedents: ["task_action(current)", "missing_prompt(current)"],
        consequent: "deny_action(current)",
        id: "policy-v1-task-deny-missing-prompt",
      },
      {
        antecedents: ["task_action(current)", "missing_description(current)"],
        consequent: "deny_action(current)",
        id: "policy-v1-task-deny-missing-description",
      },
      {
        antecedents: ["task_action(current)", "missing_load_skills(current)"],
        consequent: "deny_action(current)",
        id: "policy-v1-task-deny-missing-load-skills",
      },
      {
        antecedents: ["internal_orchestration_task(current)", "missing_internal_target(current)"],
        consequent: "deny_action(current)",
        id: "policy-v1-internal-task-deny-missing-target",
      },
      {
        antecedents: ["delegated_work_task(current)", "missing_delegated_target(current)"],
        consequent: "deny_action(current)",
        id: "policy-v1-delegated-task-deny-missing-target",
      },
    ],
    defeasible_rules: [],
    preferences: [],
    classical_negation: true,
  }
}

function extractTheoryOverride(
  sessionContext: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!sessionContext) return undefined
  const override = sessionContext.theory_override
  return isRecord(override) ? override : undefined
}
