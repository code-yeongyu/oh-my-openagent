import type { DeliberationRequest } from "../../agents/themis/types"
import type {
  ReasonArgueRequest,
  ReasoningCoreSolveProblem,
} from "../../hooks/reasoning-core-policy-gate/reasoning-core-client"

const DEFAULT_MAX_ITERATIONS = 3

export function buildDeliberationSolveProblem(
  request: DeliberationRequest,
  theory: ReasonArgueRequest["theory"],
): ReasoningCoreSolveProblem {
  return {
    description: buildSolveDescription(request),
    variables: [
      ...request.options.map((_, index) => ({ name: `option_${index}_selected`, domain: [0, 1] })),
      ...request.constraints.map((_, index) => ({ name: `constraint_${index}_satisfied`, domain: [0, 1] })),
    ],
    initial_constraints: request.constraints.map((constraint, index) => ({
      constraint: { Equals: { variable: `constraint_${index}_satisfied`, value: 1 } },
      question: constraint,
    })),
    incremental_constraints: [],
    max_iterations: DEFAULT_MAX_ITERATIONS,
    theory: {
      premises: theory.premises,
      strict_rules: theory.strict_rules ?? [],
      defeasible_rules: theory.defeasible_rules ?? [],
      preferences: theory.preferences ?? [],
      classical_negation: theory.classical_negation !== false,
    },
  }
}

function buildSolveDescription(request: DeliberationRequest): string {
  const lines = [request.problem_statement]

  if (request.context) {
    lines.push(`Context: ${request.context}`)
  }

  if (request.options.length > 0) {
    lines.push("Options:")
    lines.push(...request.options.map(option => `- ${option}`))
  }

  if (request.constraints.length > 0) {
    lines.push("Constraints:")
    lines.push(...request.constraints.map(constraint => `- ${constraint}`))
  }

  return lines.join("\n")
}
