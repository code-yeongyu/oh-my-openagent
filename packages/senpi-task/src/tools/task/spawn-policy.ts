import { canonicalAgentName } from "../../agents"

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
  // The whole policy chain operates on the canonical id from the legacy alias table, so a retired
  // curated id is denied or contracted exactly like its canonical replacement.
  const canonical = canonicalAgentName(subagentType).name
  const denial = invocationGateDenial(deps, canonical, sessionId)
  if (denial !== undefined) return { kind: "deny", message: denial }
  const contract = planReviewContractOutcome(deps, canonical, callerPrompt, sessionId)
  if (contract?.kind === "deny") return { kind: "deny", message: contract.message }
  if (contract?.kind === "prompt") return { kind: "force", prompt: contract.prompt }
  return { kind: "allow" }
}
