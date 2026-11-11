import { ULW_REVIEWER_AGENT_NAMES } from "../../../agents/builtin"
import { canonicalAgentName } from "../../../agents/builtin/legacy-agent-names"
import { RunnerError } from "../../in-process/runner-error"

/**
 * The review-role agents (code reviewer, QA executor, gate reviewer) run only out of process under
 * the deny-live sandbox (senpi#6287). The policy is derived from the canonical agent identity on
 * every launch, so a record written before the policy existed, or an omo.json overlay, cannot drop it.
 */
export function requiresDenyLive(agentType: string | undefined): boolean {
  return agentType !== undefined && ULW_REVIEWER_AGENT_NAMES.has(canonicalAgentName(agentType))
}

export function sandboxRequired(message: string): RunnerError {
  return new RunnerError({ kind: "sandbox_required", message })
}
