import type {
  ReasoningCoreSolveOutcome,
  ReasoningCoreSolveProblem,
} from "../../hooks/reasoning-core-policy-gate/reasoning-core-client"

const CONVERGED_SIGNALS = new Set(["converged", "solved", "solution_found", "completed", "complete"])

export interface SolveMetacognition {
  stop_signal: string
  iterations_used: number
  converged: boolean
  domain_reduction_rate: number
  domains_solved: number
  domains_total: number
  constraint_solved: boolean
  reasoning_trace_length: number
}

export function buildSolveMetacognition(input: {
  solveOutcome: ReasoningCoreSolveOutcome
  solveProblem: ReasoningCoreSolveProblem
}): SolveMetacognition {
  const { solveOutcome, solveProblem } = input

  return {
    stop_signal: solveOutcome.stop_signal,
    iterations_used: solveOutcome.iterations_used,
    converged: isConverged(solveOutcome),
    domain_reduction_rate: calculateDomainReductionRate(solveProblem, solveOutcome),
    domains_solved: solveOutcome.constraint_state.solved_count,
    domains_total: solveOutcome.constraint_state.total_count,
    constraint_solved: solveOutcome.constraint_state.solved,
    reasoning_trace_length: solveOutcome.reasoning_trace.length,
  }
}

function isConverged(solveOutcome: ReasoningCoreSolveOutcome): boolean {
  if (solveOutcome.constraint_state.solved) {
    return true
  }

  return CONVERGED_SIGNALS.has(solveOutcome.stop_signal.toLowerCase())
}

function calculateDomainReductionRate(
  solveProblem: ReasoningCoreSolveProblem,
  solveOutcome: ReasoningCoreSolveOutcome,
): number {
  const initialDomainSize = solveProblem.variables.reduce((sum, variable) => sum + variable.domain.length, 0)

  if (initialDomainSize === 0) {
    return 0
  }

  const finalDomainSize = solveProblem.variables.reduce((sum, variable) => {
    const finalDomain = solveOutcome.constraint_state.domains[variable.name]
    return sum + (Array.isArray(finalDomain) && finalDomain.length > 0 ? finalDomain.length : variable.domain.length)
  }, 0)

  return Math.max(0, Math.min(1, 1 - finalDomainSize / initialDomainSize))
}
