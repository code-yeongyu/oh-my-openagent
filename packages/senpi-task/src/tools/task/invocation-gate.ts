import { EMPTY_SKILL_INVOCATIONS, evaluateInvocationGuard, invocationConditionForAgent } from "../../agents"

import type { TaskToolDeps } from "./types"

// Tool-layer bridge between the harness-neutral invocation guard and the per-call session: resolves
// the session's skill-invocation state and returns the denial message, or undefined when the spawn
// may proceed. A missing resolver fails CLOSED - without session state there is no proof the
// required skill was invoked.
export function invocationGateDenial(deps: TaskToolDeps, subagentType: string, sessionId: string): string | undefined {
  const name = subagentType.trim()
  if (invocationConditionForAgent(name) === undefined) return undefined
  const state = deps.resolveSkillInvocations?.(sessionId) ?? EMPTY_SKILL_INVOCATIONS
  const verdict = evaluateInvocationGuard(name, state)
  return verdict.kind === "deny" ? verdict.message : undefined
}
