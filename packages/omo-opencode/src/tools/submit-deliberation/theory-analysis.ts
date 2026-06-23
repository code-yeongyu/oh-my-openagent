import { detectPreferenceCycle } from "../../hooks/epistemic-state-interpreter/preference-circuit-breaker"
import {
  detectDomain,
  getAudiencesForDomain,
  solveValueBasedArgumentation,
  theoryContainsValueTags,
} from "../../hooks/reasoning-core-policy-gate/value-based-argumentation"
import type { ReasonArgueRequest, ReasoningCoreClient } from "../../hooks/reasoning-core-policy-gate/reasoning-core-client"

export async function analyzeTheoryForResponse(input: {
  client: ReasoningCoreClient
  problemStatement: string
  requestedSemantics: NonNullable<ReasonArgueRequest["semantics"]>
  theory: ReasonArgueRequest["theory"]
}) {
  const preferenceCycle = detectPreferenceCycle(Array.isArray(input.theory.preferences)
    ? input.theory.preferences.filter((preference: unknown): preference is { superior: string; inferior: string } => {
      if (typeof preference !== "object" || preference === null) return false
      const candidate = preference as { superior?: unknown; inferior?: unknown }
      return typeof candidate.superior === "string" && typeof candidate.inferior === "string"
    })
    : [])
  const audienceAnalysis = theoryContainsValueTags(input.theory)
    ? await solveValueBasedArgumentation({
        client: input.client,
        theory: input.theory,
        requestedSemantics: input.requestedSemantics,
        audiences: getAudiencesForDomain(detectDomain(input.problemStatement)),
      })
    : undefined

  return { preferenceCycle, audienceAnalysis }
}
