import { EMPTY_SKILL_INVOCATIONS, canonicalAgentName, evaluateInvocationGuard, invocationConditionForAgent } from "../../agents"

import type { TaskToolDeps } from "./types"

// Tool-layer bridge between the harness-neutral invocation guard and the per-call session: resolves
// the session's skill-invocation state and returns the denial message, or undefined when the spawn
// may proceed. A missing resolver fails CLOSED - without session state there is no proof the
// required skill was invoked.
export function invocationGateDenial(deps: TaskToolDeps, subagentType: string, sessionId: string): string | undefined {
  // The gate runs on the canonical id (todo 1's alias table): a legacy curated id is gated
  // identically to its canonical replacement and the denial names the canonical agent.
  const canonical = canonicalAgentName(subagentType).name
  if (invocationConditionForAgent(canonical) === undefined) return undefined
  const state = deps.resolveSkillInvocations?.(sessionId) ?? EMPTY_SKILL_INVOCATIONS
  const verdict = evaluateInvocationGuard(canonical, state)
  return verdict.kind === "deny" ? verdict.message : undefined
}
