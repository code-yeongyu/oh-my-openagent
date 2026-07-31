// Plan-gated agents are plan-review specialists whose verdicts only make sense BEFORE execution
// begins: a session that never produced a plan (ulw-plan) has nothing for them to review, and a
// session that already started executing (start-work) must not be pulled back into plan review.
// This module owns the classification data and the pure verdict logic; the session-scoped
// skill-invocation state is supplied by the host adapter (omo-senpi) via
// TaskToolDeps.resolveSkillInvocations, keeping senpi-task harness-neutral.

export type AgentInvocationCondition = {
  readonly requiresSkills: readonly string[]
  readonly forbidsSkills: readonly string[]
}

export const AGENT_INVOCATION_CONDITIONS = {
  metis: { requiresSkills: ["ulw-plan"], forbidsSkills: ["start-work"] },
  momus: { requiresSkills: ["ulw-plan"], forbidsSkills: ["start-work"] },
} as const satisfies Readonly<Record<string, AgentInvocationCondition>>

const CONDITIONS: Readonly<Record<string, AgentInvocationCondition>> = AGENT_INVOCATION_CONDITIONS

export const PLAN_GATED_AGENT_NAMES: ReadonlySet<string> = new Set(Object.keys(AGENT_INVOCATION_CONDITIONS))

export type SkillInvocationState = {
  readonly hasInvoked: (skill: string) => boolean
}

export const EMPTY_SKILL_INVOCATIONS: SkillInvocationState = { hasInvoked: () => false }

export type InvocationGuardVerdict =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly message: string }

export function invocationConditionForAgent(agentName: string): AgentInvocationCondition | undefined {
  return CONDITIONS[agentName]
}

export function evaluateInvocationGuard(agentName: string, state: SkillInvocationState): InvocationGuardVerdict {
  const condition = invocationConditionForAgent(agentName)
  if (condition === undefined) return { kind: "allow" }

  // Forbidden skills win over missing requirements: once start-work ran, "invoke ulw-plan first"
  // is wrong advice - the gate stays closed for the rest of the session either way.
  const violated = condition.forbidsSkills.find((skill) => state.hasInvoked(skill))
  if (violated !== undefined) {
    return {
      kind: "deny",
      message:
        `Agent "${agentName}" is plan-gated and cannot be spawned: the ${violated} skill was already invoked in this session, ` +
        `so plan review is no longer available. Continue the work directly or choose another agent.`,
    }
  }

  const missing = condition.requiresSkills.filter((skill) => !state.hasInvoked(skill))
  if (missing.length > 0) {
    const skills = missing.join(", ")
    return {
      kind: "deny",
      message:
        `Agent "${agentName}" is plan-gated and cannot be spawned yet: this session has not invoked the required skill (${skills}). ` +
        `Invoke it first (for example /skill:${skills} or by reading its SKILL.md), then retry.`,
    }
  }

  return { kind: "allow" }
}
