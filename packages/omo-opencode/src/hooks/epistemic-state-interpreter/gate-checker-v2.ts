import type { EpistemicGateMode } from "../../config/schema/epistemic-gate"
import type { MultiPlaneState, AmmissibilitaState, DominanzaDecisionale } from "./multi-plane-types"

export interface MultiPlaneGateResult {
  allowed: boolean
  reason: string
  plane: string
}

function blockedByPianoAResult(
  mode: Exclude<EpistemicGateMode, "annotation">,
  conclusion: string,
  pianoA: AmmissibilitaState,
): MultiPlaneGateResult {
  return {
    allowed: false,
    reason: `${mode} mode: conclusion '${conclusion}' blocked by pianoA (state=${pianoA})`,
    plane: "pianoA",
  }
}

function blockedByPianoCResult(
  mode: Exclude<EpistemicGateMode, "annotation">,
  conclusion: string,
): MultiPlaneGateResult {
  return {
    allowed: false,
    reason: `${mode} mode: conclusion '${conclusion}' blocked by pianoC (inconclusivo=true)`,
    plane: "pianoC",
  }
}

function allowedResult(
  mode: Exclude<EpistemicGateMode, "annotation">,
  conclusion: string,
): MultiPlaneGateResult {
  return {
    allowed: true,
    reason: `${mode} mode: conclusion '${conclusion}' allowed`,
    plane: "none",
  }
}

function isBlockedByPianoC(state: MultiPlaneState): boolean {
  return state.pianoC.inconclusivo
}

function isBlockedByDominance(
  pianoD: DominanzaDecisionale,
  conclusion: string,
): boolean {
  return pianoD.dominante !== null && conclusion !== pianoD.dominante
}

export function isBlockedByPianoA(state: AmmissibilitaState, mode: EpistemicGateMode): boolean {
  if (mode === "annotation") {
    return false
  }

  return state === "escluso" || state === "escluso_operativamente"
}

export function checkMultiPlaneGate(
  state: MultiPlaneState,
  mode: EpistemicGateMode,
  conclusion: string,
): MultiPlaneGateResult {
  if (mode === "annotation") {
    return { allowed: true, reason: "annotation mode: gate disabled", plane: "none" }
  }

  if (mode === "dominance" && state.pianoD !== null && isBlockedByDominance(state.pianoD, conclusion)) {
    return {
      allowed: false,
      reason: `dominance mode: conclusion '${conclusion}' blocked by pianoD (dominante=${state.pianoD.dominante})`,
      plane: "pianoD",
    }
  }

  if (isBlockedByPianoA(state.pianoA, mode)) {
    return blockedByPianoAResult(mode, conclusion, state.pianoA)
  }

  if (isBlockedByPianoC(state)) {
    return blockedByPianoCResult(mode, conclusion)
  }

  return allowedResult(mode, conclusion)
}
