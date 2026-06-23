import type { DeliberationResponse } from "../../agents/themis/types"
import type { ConvergenceStatus } from "../../hooks/reasoning-core-policy-gate/extended-response-types"
import type {
  ReasoningCoreClient,
  ReasoningCoreMetacognitiveState,
  ReasoningCoreMetacognitiveVerdict,
  ReasoningCoreSolveOutcome,
} from "../../hooks/reasoning-core-policy-gate/reasoning-core-client"

const CONVERGED_SIGNALS = new Set(["solved", "converged", "solution_found", "completed", "complete", "done"])
const LOOPING_SIGNALS = new Set(["looping", "budget_exhausted", "iteration_cap"])
const CONFLICT_MARKERS = [
  "unable_to_converge",
  "fundamental_conflict",
  "contradiction",
  "contradictory",
  "inconsistent",
  "unsatisfiable",
  "unsat",
  "mutually_exclusive",
]

export interface ConvergenceVerificationResult {
  convergence: ConvergenceStatus
  verdict?: DeliberationResponse["verdict"]
}

export async function verifySolveConvergence(input: {
  client: Pick<ReasoningCoreClient, "check">
  sessionKey: string
  solveOutcome: ReasoningCoreSolveOutcome
}): Promise<ConvergenceVerificationResult> {
  const verdict = await input.client.check(input.sessionKey, buildConvergenceState(input.solveOutcome))
  return mapConvergenceVerdict(verdict)
}

function buildConvergenceState(solveOutcome: ReasoningCoreSolveOutcome): ReasoningCoreMetacognitiveState {
  const totalCount = solveOutcome.constraint_state.total_count
  const solvedCount = solveOutcome.constraint_state.solved_count

  return {
    iteration: solveOutcome.iterations_used,
    domain_reduction_rate: totalCount > 0 ? solvedCount / totalCount : 0,
    domains_solved: solvedCount,
    domains_total: totalCount,
    extensions_count: 1,
  }
}

function mapConvergenceVerdict(verdict: ReasoningCoreMetacognitiveVerdict): ConvergenceVerificationResult {
  if (isUnableToConverge(verdict)) {
    return { convergence: "unable_to_converge", verdict: "unable_to_converge" }
  }

  const normalizedSignal = normalize(verdict.signal)
  if (LOOPING_SIGNALS.has(normalizedSignal)) {
    return { convergence: "looping" }
  }
  if (CONVERGED_SIGNALS.has(normalizedSignal)) {
    return { convergence: "converged" }
  }
  return { convergence: "not_converged" }
}

function isUnableToConverge(verdict: ReasoningCoreMetacognitiveVerdict): boolean {
  const normalizedText = `${normalize(verdict.signal)} ${normalize(verdict.reason)}`
  return CONFLICT_MARKERS.some((marker) => normalizedText.includes(marker))
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}
