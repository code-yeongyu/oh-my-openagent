import { invocationGateDenial } from "./invocation-gate"
import { planReviewContractOutcome } from "./plan-review-contract"
import type { TaskToolDeps } from "./types"

// Single composition point for every subagent_type spawn restriction, used by both the single and
// batch spawn paths: the plan gate first (invocation guard), then the plan-review prompt contract.
export type SpawnPolicyVerdict =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly message: string }
  | { readonly kind: "force"; readonly prompt: string }

export function evaluateSpawnPolicy(
  deps: TaskToolDeps,
  subagentType: string,
  callerPrompt: string,
  sessionId: string,
): SpawnPolicyVerdict {
  const denial = invocationGateDenial(deps, subagentType, sessionId)
  if (denial !== undefined) return { kind: "deny", message: denial }
  const contract = planReviewContractOutcome(deps, subagentType, callerPrompt, sessionId)
  if (contract?.kind === "deny") return { kind: "deny", message: contract.message }
  if (contract?.kind === "prompt") return { kind: "force", prompt: contract.prompt }
  return { kind: "allow" }
}
