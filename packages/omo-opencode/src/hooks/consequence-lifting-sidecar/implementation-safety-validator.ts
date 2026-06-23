import type { QualifiedPolicy } from "./types"
import type {
  ImplementationSafetyConclusionState,
  ImplementationSafetyValidation,
  ImplementationSafetyViolation,
} from "./safety-validation-types"

const BLOCKING_TAGS = new Set(["constraint:infeasible", "constraint:temporal_window_closed", "feasible:false"])

function hasBlockingConstraint(state: ImplementationSafetyConclusionState): boolean {
  return state.blocked || state.tags.some((tag) => BLOCKING_TAGS.has(tag))
}

function getDependencies(conclusion: string, states: Map<string, ImplementationSafetyConclusionState>): string[] {
  const proofChain = states.get(conclusion)?.proofChain ?? []
  return [...new Set(proofChain.flatMap((step) => step.from ?? step.antecedents ?? []).filter((item): item is string => typeof item === "string"))]
}

function dependsOn(
  conclusion: string,
  dependency: string,
  states: Map<string, ImplementationSafetyConclusionState>,
  visited = new Set<string>(),
): boolean {
  if (visited.has(conclusion)) return false
  visited.add(conclusion)

  const directDependencies = getDependencies(conclusion, states)
  if (directDependencies.includes(dependency)) return true
  return directDependencies.some((candidate) => dependsOn(candidate, dependency, states, visited))
}

function createUnavailableStepViolation(
  kind: "missing_required_step" | "unaccepted_required_step" | "blocked_required_step",
  conclusion: string,
  state?: ImplementationSafetyConclusionState,
): ImplementationSafetyViolation {
  if (kind === "missing_required_step") {
    return {
      kind,
      conclusion,
      message: `Required implementation step ${conclusion} is not available in the accepted conclusions`,
      relatedConclusions: [],
    }
  }

  if (kind === "unaccepted_required_step") {
    return {
      kind,
      conclusion,
      message: `Required implementation step ${conclusion} is not accepted for execution`,
      relatedConclusions: [],
    }
  }

  return {
    kind,
    conclusion,
    message: `Required implementation step ${conclusion} is blocked by feasibility or temporal constraints`,
    relatedConclusions: state?.tags.filter((tag) => BLOCKING_TAGS.has(tag)) ?? [],
  }
}

export function validateImplementationSafety(
  policy: QualifiedPolicy,
  states: Map<string, ImplementationSafetyConclusionState>,
): ImplementationSafetyValidation {
  const violations: ImplementationSafetyViolation[] = []
  const requiredSteps = [...new Set([...policy.requiredMitigations, ...policy.requiredConditions])]
  const unavailableSteps = new Set<string>()

  for (const step of requiredSteps) {
    const state = states.get(step)
    if (!state) {
      unavailableSteps.add(step)
      violations.push(createUnavailableStepViolation("missing_required_step", step))
      continue
    }

    if (state.status !== "Accepted") {
      unavailableSteps.add(step)
      violations.push(createUnavailableStepViolation("unaccepted_required_step", step, state))
      continue
    }

    if (hasBlockingConstraint(state)) {
      unavailableSteps.add(step)
      violations.push(createUnavailableStepViolation("blocked_required_step", step, state))
    }
  }

  for (const burden of policy.profile.forwardBurdens) {
    if (burden.liftStrength !== "strong_lift") continue

    const implementationSteps = requiredSteps.filter((step) => dependsOn(burden.conclusion, step, states))
    if (implementationSteps.length === 0) continue

    const hasUnavailableMitigation = burden.mitigatedBy.some((mitigation) => unavailableSteps.has(mitigation))
    if (burden.mitigationStatus !== "unmitigated" && !hasUnavailableMitigation) continue

    violations.push({
      kind: "implementation_path_burden",
      conclusion: burden.conclusion,
      message: `Implementation path for ${policy.primaryDecision} leaves strong burden ${burden.conclusion} unresolved`,
      relatedConclusions: implementationSteps,
    })
  }

  return {
    status: violations.length > 0 ? "implementationUnsafe" : "implementationSafe",
    violations,
  }
}
