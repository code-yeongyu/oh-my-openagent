import type { EpistemicGateMode } from "../../config/schema/epistemic-gate"
import type { ConfidenceWeights } from "../../config/schema/epistemic-v5"
import { log } from "../../shared/logger"
import type {
  MoralContextDefaults,
  PragmaticWeights,
  TransitionThresholds,
} from "../../config/schema/epistemic-v6"
import {
  persistAnnotationsForSession,
  storeMultiPlaneAnnotations,
  storeSessionHooks,
} from "./annotation-store-v2"
import { checkMultiPlaneGate } from "./gate-checker-v2"
import { computePianoD } from "./piano-d-engine"
import { parseProofArtifact } from "./proof-artifact-parser"
import { processConclusion } from "./hook-v2-conclusion-processor"
import type { ProcessConclusionInput, ProcessedConclusion } from "./hook-v2-conclusion-processor"
import { getVerdict } from "./verdict-store"

export interface MultiPlaneHookConfig {
  enabled: boolean
  epistemic_gate_mode?: EpistemicGateMode
  plausibilita_threshold: number
  ethical_value_hierarchy: string[]
  pragmatic_weights: PragmaticWeights
  moral_context_defaults: MoralContextDefaults
  transition_thresholds: TransitionThresholds
  confidence_weights: ConfidenceWeights
}

export interface MultiPlaneHook {
  "tool.execute.after": (
    input: { tool: string; sessionID: string; callID: string },
    output: { response: unknown },
  ) => Promise<void>
}

interface MultiPlaneHookDeps {
  log: typeof log
  parseProofArtifact: typeof parseProofArtifact
  processConclusion: (input: ProcessConclusionInput) => ProcessedConclusion
  computePianoD: typeof computePianoD
  storeSessionHooks: typeof storeSessionHooks
  storeMultiPlaneAnnotations: typeof storeMultiPlaneAnnotations
  persistAnnotationsForSession: typeof persistAnnotationsForSession
  checkMultiPlaneGate: typeof checkMultiPlaneGate
  getVerdict: typeof getVerdict
}

const SUPPORTED_TOOL_PATTERNS = ["reason_argue", "reason_solve"]
const DEFAULT_GATE_MODE: EpistemicGateMode = "annotation"

const DEFAULT_DEPS: MultiPlaneHookDeps = {
  log,
  parseProofArtifact,
  processConclusion,
  computePianoD,
  storeSessionHooks,
  storeMultiPlaneAnnotations,
  persistAnnotationsForSession,
  checkMultiPlaneGate,
  getVerdict,
}

export function createMultiPlaneHook(config: MultiPlaneHookConfig, deps: MultiPlaneHookDeps = DEFAULT_DEPS): MultiPlaneHook {
  return {
    "tool.execute.after": async (input, output): Promise<void> => {
      if (!config.enabled || !SUPPORTED_TOOL_PATTERNS.some((p) => input.tool.includes(p))) {
        return
      }

      try {
        const parsed = deps.parseProofArtifact(output.response)
        if (parsed === null) {
          return
        }

        const policyVerdict = deps.getVerdict(`${input.sessionID}:${input.callID}`) ?? null
        const timestamp = Date.now()
        const processed = [...parsed.conclusions.entries()].map(([conclusion, parsedConclusion]) =>
          deps.processConclusion({
            config,
            response: output.response,
            sessionID: input.sessionID,
            callID: input.callID,
            conclusion,
            parsedConclusion,
            extensionCount: parsed.extensionCount,
            totalConclusions: parsed.conclusions.size,
            timestamp,
          }),
        )
        const pianoD = deps.computePianoD({
          conclusions: processed.map(({ annotation, valutazione, blocked }) => ({
            conclusion: annotation.conclusion,
            valutazione,
            blocked,
          })),
        })

        for (const { annotation } of processed) {
          annotation.state.pianoD = pianoD
          annotation.policyVerdict = policyVerdict
        }

        deps.storeSessionHooks(
          input.sessionID,
          processed.map(({ hook }) => hook),
        )
        deps.storeMultiPlaneAnnotations(
          input.sessionID,
          processed.map(({ annotation }) => annotation),
        )
        deps.persistAnnotationsForSession(input.sessionID)

        for (const { annotation } of processed) {
          const gate = deps.checkMultiPlaneGate(
            annotation.state,
            config.epistemic_gate_mode ?? DEFAULT_GATE_MODE,
            annotation.conclusion,
          )
          if (!gate.allowed) {
            throw new Error(`[epistemic gate] ${gate.reason}`)
          }

          deps.log("[epistemic-v2] annotation updated", {
            sessionID: input.sessionID,
            conclusion: annotation.conclusion,
            pianoA: annotation.state.pianoA,
            probability: annotation.state.pianoB.probabile,
            inconclusive: annotation.state.pianoC.inconclusivo,
            callID: input.callID,
            policyVerdictAllow: policyVerdict?.allow ?? null,
          })
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("[epistemic gate]")) {
          throw error
        }

        deps.log("[epistemic-v2] pipeline failed - continuing", {
          sessionID: input.sessionID,
          tool: input.tool,
          callID: input.callID,
          error: String(error),
        })
      }
    },
  }
}
