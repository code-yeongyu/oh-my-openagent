// Plan-gated agents are plan-review specialists whose verdicts only make sense BEFORE execution
// begins. The gate is deliberately strict: the USER must have explicitly requested the ulw-plan
// workflow (a model-initiated SKILL.md read proves nothing), a plan artifact must have been
// touched, and a session that already started executing (start-work) must not be pulled back into
// plan review. This module owns the classification data and the pure verdict logic; the
// session-scoped skill-invocation state is supplied by the host adapter (omo-senpi) via
// TaskToolDeps.resolveSkillInvocations, keeping senpi-task harness-neutral.

export type AgentInvocationCondition = {
  readonly requiresSkills: readonly string[]
  readonly requiresPlanArtifact: boolean
  readonly forbidsSkills: readonly string[]
}

export const AGENT_INVOCATION_CONDITIONS = {
  metis: { requiresSkills: ["ulw-plan"], requiresPlanArtifact: true, forbidsSkills: ["start-work"] },
  momus: { requiresSkills: ["ulw-plan"], requiresPlanArtifact: true, forbidsSkills: ["start-work"] },
} as const satisfies Readonly<Record<string, AgentInvocationCondition>>

const CONDITIONS: Readonly<Record<string, AgentInvocationCondition>> = AGENT_INVOCATION_CONDITIONS

export const PLAN_GATED_AGENT_NAMES: ReadonlySet<string> = new Set(Object.keys(AGENT_INVOCATION_CONDITIONS))

// A single plan-artifact path touched in a session. lastTouchedAt is a monotonic per-tracker
// sequence number, NOT a wall-clock timestamp, so ordering never depends on clock resolution.
export type PlanArtifactReference = {
  readonly path: string
  readonly count: number
  readonly lastTouchedAt: number
}

// hasInvoked observes every invocation channel (SKILL.md read, slash command) and feeds the
// forbids check. hasUserRequested is strictly the user-input channel - a model cannot manufacture
// it - and is the only channel that satisfies requiresSkills. hasPlanArtifact reports whether a
// .omo/plans/*.md file (at ANY root - worktrees and external checkouts included) was touched in
// this session. planArtifactReferences exposes the per-path counts behind it, sorted by count
// desc then lastTouchedAt desc, so consumers can pick the session's most-referenced plan.
export type SkillInvocationState = {
  readonly hasInvoked: (skill: string) => boolean
  readonly hasUserRequested: (skill: string) => boolean
  readonly hasPlanArtifact: () => boolean
  readonly planArtifactReferences: () => readonly PlanArtifactReference[]
}

export const EMPTY_SKILL_INVOCATIONS: SkillInvocationState = {
  hasInvoked: () => false,
  hasUserRequested: () => false,
  hasPlanArtifact: () => false,
  planArtifactReferences: () => [],
}

export type InvocationGuardVerdict =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly message: string }

export function invocationConditionForAgent(agentName: string): AgentInvocationCondition | undefined {
  return CONDITIONS[agentName]
}

export function evaluateInvocationGuard(agentName: string, state: SkillInvocationState): InvocationGuardVerdict {
  const condition = invocationConditionForAgent(agentName)
  if (condition === undefined) return { kind: "allow" }

  // Forbidden skills win over missing requirements: once start-work ran, plan review is over for
  // this session either way, so advice about arranging a plan review would be wrong.
  const violated = condition.forbidsSkills.find((skill) => state.hasInvoked(skill))
  if (violated !== undefined) {
    return {
      kind: "deny",
      message:
        `Agent "${agentName}" is plan-gated and cannot be spawned: the ${violated} skill was already invoked in this session, ` +
        `so plan review is no longer available. Continue the work directly or choose another agent.`,
    }
  }

  // The requirement is a USER request, never a model-initiated invocation. The denial names the
  // USER-driven unlock so the model stops re-spawning blindly, while still refusing to let the
  // model arm the gate itself: every route named here is one only a human can take.
  const missing = condition.requiresSkills.filter((skill) => !state.hasUserRequested(skill))
  if (missing.length > 0) {
    const names = missing.join(", ")
    return {
      kind: "deny",
      message:
        `Agent "${agentName}" is plan-gated: it is available only after the user explicitly requests the ${names} ` +
        `workflow in this session, and no such request was made. Do not attempt to unlock this gate yourself - retrying ` +
        `this spawn will keep failing. Continue without plan review (self-review instead), or ask the user to start the ` +
        `workflow themselves by running /skill:${names} or by asking for a plan in their own words.`,
    }
  }

  if (condition.requiresPlanArtifact && !state.hasPlanArtifact()) {
    return {
      kind: "deny",
      message:
        `Agent "${agentName}" is plan-gated: no plan artifact (.omo/plans/*.md) was touched in this session, so there is no ` +
        `plan to review yet. Complete the ${condition.requiresSkills.join(", ")} workflow so it produces a plan file, then retry.`,
    }
  }

  return { kind: "allow" }
}
