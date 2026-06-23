import type { EpistemicGateMode } from "../../config/schema/epistemic-gate"
import {
  storeMultiPlaneAnnotations,
  storeSessionHooks,
} from "../../hooks/epistemic-state-interpreter/annotation-store-v2"
import { checkMultiPlaneGate } from "../../hooks/epistemic-state-interpreter/gate-checker-v2"
import type { MultiPlaneHookConfig } from "../../hooks/epistemic-state-interpreter/hook-v2"
import {
  processConclusion,
  type ProcessedConclusion,
} from "../../hooks/epistemic-state-interpreter/hook-v2-conclusion-processor"
import { computePianoD } from "../../hooks/epistemic-state-interpreter/piano-d-engine"
import { parseProofArtifact } from "../../hooks/epistemic-state-interpreter/proof-artifact-parser"
import { log } from "../../shared/logger"
import { runConsequenceLiftingSidecar } from "../../hooks/consequence-lifting-sidecar/sidecar"
import type { SidecarOutput } from "../../hooks/consequence-lifting-sidecar/types"

const DEFAULT_GATE_MODE: EpistemicGateMode = "annotation"

function createProcessedConclusions(
  response: unknown,
  sessionID: string,
  callID: string,
  config: MultiPlaneHookConfig,
) {
  const needsWrap = isRecord(response) && !("result" in response)
  const artifact = needsWrap ? { result: response } : response
  const parsed = parseProofArtifact(artifact)
  if (parsed === null) {
    return null
  }

  const timestamp = Date.now()

  return [...parsed.conclusions.entries()].map(([conclusion, parsedConclusion]) =>
    processConclusion({
      config,
      response: artifact,
      sessionID,
      callID,
      conclusion,
      parsedConclusion,
      extensionCount: parsed.extensionCount,
      totalConclusions: parsed.conclusions.size,
      timestamp,
    }),
  )
}

function logGateResult(
  sessionID: string,
  callID: string,
  config: MultiPlaneHookConfig,
  annotation: ProcessedConclusion["annotation"],
  valutazione?: ProcessedConclusion["valutazione"],
): void {
  const gate = checkMultiPlaneGate(
    annotation.state,
    config.epistemic_gate_mode ?? DEFAULT_GATE_MODE,
    annotation.conclusion,
  )

  if (!gate.allowed) {
    log("[epistemic-v2] gate blocked - continuing", {
      sessionID,
      conclusion: annotation.conclusion,
      callID,
      plane: gate.plane,
      reason: gate.reason,
    })
  }

  log("[epistemic-v2] annotation updated", {
    sessionID,
    conclusion: annotation.conclusion,
    pianoA: annotation.state.pianoA,
    probability: annotation.state.pianoB.probabile,
    plausibile: annotation.state.pianoB.plausibile,
    inconclusive: annotation.state.pianoC.inconclusivo,
    pianoD: annotation.state.pianoD?.preferibile_ma_non_certo ?? null,
    callID,
  })

  if (valutazione) {
    log("[epistemic-v2] valutazione", {
      sessionID,
      conclusion: annotation.conclusion,
      combined: valutazione.combined,
      eticoLabel: valutazione.etico.label,
      eticoScore: valutazione.etico.score,
      pragmaticoLabel: valutazione.pragmatico.label,
      pragmaticoScore: valutazione.pragmatico.score,
      moraleLabel: valutazione.morale.label,
      moraleScore: valutazione.morale.score,
      divergente: valutazione.divergente,
      callID,
    })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function runEpistemicPipeline(
  response: unknown,
  sessionID: string,
  callID: string,
  config: MultiPlaneHookConfig,
): SidecarOutput | null {
  try {
    const needsWrap = isRecord(response) && !("result" in response)
    const artifact = needsWrap ? { result: response } : response
    const processed = createProcessedConclusions(response, sessionID, callID, config)
    if (processed === null) {
      return null
    }

    const pianoD = computePianoD({
      conclusions: processed.map(({ annotation, valutazione, blocked }) => ({
        conclusion: annotation.conclusion,
        valutazione,
        blocked,
      })),
    })

    for (const { annotation } of processed) {
      annotation.state.pianoD = pianoD
    }

    storeSessionHooks(
      sessionID,
      processed.map(({ hook }) => hook),
    )
    storeMultiPlaneAnnotations(
      sessionID,
      processed.map(({ annotation }) => annotation),
    )

    for (const { annotation, valutazione } of processed) {
      logGateResult(sessionID, callID, config, annotation, valutazione)
    }

    const sidecarResult = runSidecarSafely(processed, artifact, sessionID, callID)
    if (sidecarResult) {
      logSidecarResult(sessionID, callID, sidecarResult)
    }
    return sidecarResult
  } catch (error) {
    log("[epistemic-v2] pipeline failed - continuing", {
      sessionID,
      callID,
      error: String(error),
    })
    return null
  }
}


function runSidecarSafely(
  processed: ProcessedConclusion[],
  proofArtifact: unknown,
  sessionID: string,
  callID: string,
): SidecarOutput | null {
  try {
    return runConsequenceLiftingSidecar({ processed, proofArtifact, sessionID, callID })
  } catch (error) {
    log("[consequence-sidecar] failed - continuing", { sessionID, callID, error: String(error) })
    return null
  }
}

function logSidecarResult(sessionID: string, callID: string, result: SidecarOutput): void {
  for (const profile of result.profiles) {
    log("[consequence-sidecar] decision-profile", {
      sessionID,
      callID,
      decision: profile.decision,
      coreStatus: profile.coreStatus,
      policyStatus: profile.policyStatus,
      qualifiers: profile.qualifiers,
      burdensCount: profile.forwardBurdens.length,
      benefitsCount: profile.forwardBenefits.length,
      requiredConditions: profile.requiredConditions,
    })
  }

  for (const policy of result.policies) {
    log("[consequence-sidecar] qualified-policy", {
      sessionID,
      callID,
      primaryDecision: policy.primaryDecision,
      policyStatus: policy.profile.policyStatus,
      qualifiers: policy.profile.qualifiers,
      requiredMitigations: policy.requiredMitigations,
      residualRisks: policy.residualRisks,
      alternativesExcluded: policy.alternativesConsidered.length,
    })
  }
}
