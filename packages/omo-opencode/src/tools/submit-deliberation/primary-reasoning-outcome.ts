import type { DeliberationRequest } from "../../agents/themis/types"
import type {
  ReasonArgueRequest,
  ReasoningCoreClient,
  ReasoningCoreSolveOutcome,
} from "../../hooks/reasoning-core-policy-gate/reasoning-core-client"
import { buildDeliberationSolveProblem } from "./deliberation-solve-problem"
import { buildSolveMetacognition, type SolveMetacognition } from "./solve-metacognition"

export interface PrimaryReasoningOutcome {
  argueResult: unknown
  solveMetacognition?: SolveMetacognition
  solveOutcome?: ReasoningCoreSolveOutcome
}

export async function resolvePrimaryReasoningOutcome(input: {
  client: ReasoningCoreClient
  theory: unknown
  requestedSemantics: NonNullable<ReasonArgueRequest["semantics"]>
  request: DeliberationRequest
}): Promise<PrimaryReasoningOutcome> {
  const argueTheory = toArgueTheory(input.theory)
  const solveProblem = argueTheory ? buildDeliberationSolveProblem(input.request, argueTheory) : null

  if (input.client.solve && solveProblem) {
    try {
      const solveOutcome = await input.client.solve(solveProblem)
      if (!hasSolveConclusions(solveOutcome)) {
        throw new Error("solve outcome missing argumentation conclusions")
      }
      return {
        argueResult: toArgueResult(solveOutcome, input.requestedSemantics),
        solveMetacognition: buildSolveMetacognition({ solveOutcome, solveProblem }),
        solveOutcome,
      }
    } catch {}
  }

  if (!input.client.argue || !argueTheory) {
    throw new Error("reasoning-core client does not support argue; cannot run deliberation pipeline")
  }

  return {
    argueResult: await input.client.argue({ semantics: input.requestedSemantics, theory: argueTheory }),
  }
}

function toArgueTheory(theory: unknown): ReasonArgueRequest["theory"] | null {
  if (!isRecord(theory) || !Array.isArray(theory.premises)) return null
  return {
    premises: theory.premises as Array<{ formula: string; kind?: string }>,
    strict_rules: Array.isArray(theory.strict_rules)
      ? theory.strict_rules as Array<{ id: string; antecedents: string[]; consequent: string }>
      : [],
    defeasible_rules: Array.isArray(theory.defeasible_rules)
      ? theory.defeasible_rules as Array<{ id: string; name?: string; antecedents: string[]; consequent: string }>
      : [],
    preferences: Array.isArray(theory.preferences)
      ? theory.preferences as Array<{ superior: string; inferior: string }>
      : [],
    classical_negation: theory.classical_negation !== false,
  }
}

function toArgueResult(
  solveOutcome: ReasoningCoreSolveOutcome,
  semantics: NonNullable<ReasonArgueRequest["semantics"]>
) {
  const rawConclusions = solveOutcome.argumentation_result?.conclusions ?? {}
  const conclusions: Record<string, { status: string; proof_chain: unknown[] }> = {}

  for (const [key, entry] of Object.entries(rawConclusions)) {
    conclusions[key] = {
      status: entry?.status ?? "Undecided",
      proof_chain: Array.isArray(entry?.proof_chain) ? entry.proof_chain : [],
    }
  }

  const acceptedConclusions = Object.entries(conclusions)
    .filter(([, entry]) => entry?.status === "Accepted")
    .map(([conclusion]) => conclusion)

  return {
    conclusions,
    extensions: [{ index: 0, accepted_conclusions: acceptedConclusions }],
    iterations_used: solveOutcome.iterations_used,
    semantics,
  }
}

function hasSolveConclusions(solveOutcome: ReasoningCoreSolveOutcome): boolean {
  return solveOutcome.argumentation_result?.conclusions !== undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
