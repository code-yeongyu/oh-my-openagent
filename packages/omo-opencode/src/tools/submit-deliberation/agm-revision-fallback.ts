import type { DeliberationResponse } from "../../agents/themis/types"
import { runAgmBeliefRevisionProtocol, type AgmRevisionTheory } from "../../hooks/reasoning-core-policy-gate/belief-revision"
import type { ConvergenceStatus } from "../../hooks/reasoning-core-policy-gate/extended-response-types"
import type { DeliberationRoundResult } from "./deliberation-round"

type FailingVerdict = "unable_to_converge" | "no_selectable_bundle"

export async function maybeApplyAgmRevision(input: {
  theory: AgmRevisionTheory
  round: DeliberationRoundResult
  reRun: (theory: AgmRevisionTheory) => Promise<DeliberationRoundResult>
}): Promise<{ response: DeliberationResponse; convergence?: ConvergenceStatus }> {
  const failingVerdict = resolveFailingVerdict(input.round)
  if (!failingVerdict) {
    return { response: input.round.response, convergence: input.round.convergence?.convergence }
  }

  const revisedResult = await runAgmBeliefRevisionProtocol({
    theory: input.theory,
    failingVerdict,
    reRun: async (theory) => {
      const round = await input.reRun(theory)
      return {
        verdict: resolveEffectiveVerdict(round),
        response: round.response,
      }
    },
  })

  if (!revisedResult) {
    return { response: input.round.response, convergence: input.round.convergence?.convergence }
  }

  return {
    response: {
      ...revisedResult.response,
      verdict: "converged_after_revision",
      revised_premises: revisedResult.revised_premises,
    },
    convergence: "converged",
  }
}

function resolveFailingVerdict(round: DeliberationRoundResult): FailingVerdict | null {
  if (round.convergence?.verdict === "unable_to_converge") {
    return "unable_to_converge"
  }
  if (round.response.verdict === "no_selectable_bundle") {
    return "no_selectable_bundle"
  }
  return null
}

function resolveEffectiveVerdict(round: DeliberationRoundResult): DeliberationResponse["verdict"] {
  return round.convergence?.verdict ?? round.response.verdict
}
