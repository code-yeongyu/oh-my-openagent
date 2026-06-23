import type { DeliberationRequest, DeliberationResponse } from "../../agents/themis/types"
import { runConsequenceLiftingSidecar } from "../../hooks/consequence-lifting-sidecar/sidecar"
import type { SidecarOutput } from "../../hooks/consequence-lifting-sidecar/types"
import { normalizeProofArtifact } from "../../hooks/epistemic-state-interpreter/normalize-proof-artifact"
import { parseProofArtifact } from "../../hooks/epistemic-state-interpreter/proof-artifact-parser"
import { buildDeliberationResponse } from "../../hooks/reasoning-core-policy-gate/deliberation-response-builder"
import { createMultiSemanticsComparator } from "../../hooks/reasoning-core-policy-gate/multi-semantics-comparator"
import type {
  ReasonArgueRequest,
  ReasoningCoreClient,
} from "../../hooks/reasoning-core-policy-gate/reasoning-core-client"
import type { SemanticsComparison } from "../../hooks/reasoning-core-policy-gate/extended-response-types"
import { log } from "../../shared/logger"
import { verifySolveConvergence, type ConvergenceVerificationResult } from "./convergence-verification"
import { mapProcessedConclusionsToEpistemicAnalysis } from "./epistemic-analysis-mapper"
import { createProcessedConclusions } from "./formalization-helpers"
import {
  resolvePrimaryReasoningOutcome,
  type PrimaryReasoningOutcome,
} from "./primary-reasoning-outcome"
import { analyzeTheoryForResponse } from "./theory-analysis"

export interface DeliberationRoundResult {
  response: DeliberationResponse
  convergence: ConvergenceVerificationResult | null
  preferenceCycle: { detected: boolean; path: string[] }
  semanticsComparison: SemanticsComparison
  audienceAnalysis?: unknown
  epistemicAnalysis?: ReturnType<typeof mapProcessedConclusionsToEpistemicAnalysis>
  solveMetacognition?: PrimaryReasoningOutcome["solveMetacognition"]
}

export async function runDeliberationRound(input: {
  client: ReasoningCoreClient
  theory: ReasonArgueRequest["theory"]
  requestedSemantics: NonNullable<ReasonArgueRequest["semantics"]>
  request: DeliberationRequest
  optionMap: Map<string, string>
  sessionID: string
  callID: string
}): Promise<DeliberationRoundResult> {
  if (!input.client.argue) {
    throw new Error("reasoning-core client does not support argue; cannot run deliberation pipeline")
  }
  const multiSemanticsComparator = createMultiSemanticsComparator({ argue: input.client.argue })
  const primaryOutcome = await resolvePrimaryReasoningOutcome({
    client: input.client,
    theory: input.theory,
    requestedSemantics: input.requestedSemantics,
    request: input.request,
  })
  const semanticsComparison = await multiSemanticsComparator.compare(input.theory)
  const { preferenceCycle, audienceAnalysis } = await analyzeTheoryForResponse({
    client: input.client,
    theory: input.theory,
    problemStatement: input.request.problem_statement,
    requestedSemantics: input.requestedSemantics,
  })
  const proofArtifact = normalizeProofArtifact(primaryOutcome.argueResult)
  const parsed = parseProofArtifact(proofArtifact)
  const processed = parsed !== null
    ? createProcessedConclusions(proofArtifact, input.sessionID, input.callID, parsed, audienceAnalysis)
    : []

  let sidecarResult: SidecarOutput | null = null
  let sidecarError: unknown = undefined

  if (processed.length > 0) {
    try {
      sidecarResult = runConsequenceLiftingSidecar({
        processed,
        proofArtifact,
        sessionID: input.sessionID,
        callID: input.callID,
      })
    } catch (error) {
      sidecarError = error
      log("[submit-deliberation] sidecar failed", { sessionID: input.sessionID, callID: input.callID, error: String(error) })
    }
  }

  const response = buildDeliberationResponse({
    request: input.request,
    theory: { semantics: input.requestedSemantics, theory: input.theory },
    argueResult: primaryOutcome.argueResult,
    optionMap: input.optionMap,
    sidecarResult,
    sidecarError,
  })
  const convergence = primaryOutcome.solveOutcome && typeof input.client.check === "function"
    ? await verifySolveConvergence({
        client: input.client,
        sessionKey: `${input.callID}:reason-check`,
        solveOutcome: primaryOutcome.solveOutcome,
      })
    : null

  return {
    response: convergence?.verdict ? { ...response, verdict: convergence.verdict } : response,
    convergence,
    preferenceCycle,
    semanticsComparison,
    ...(audienceAnalysis ? { audienceAnalysis } : {}),
    ...(processed.length > 0 ? { epistemicAnalysis: mapProcessedConclusionsToEpistemicAnalysis(processed) } : {}),
    ...(primaryOutcome.solveMetacognition ? { solveMetacognition: primaryOutcome.solveMetacognition } : {}),
  }
}
