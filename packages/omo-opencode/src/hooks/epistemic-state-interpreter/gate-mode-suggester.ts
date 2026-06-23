import type { EpistemicGateMode } from "../../config/schema/epistemic-gate"
import { log } from "../../shared/logger"

interface SuggesterState {
  cleanInvocations: number
  suggestionEmitted: boolean
}

const store = new Map<string, SuggesterState>()

const ANNOTATION_TO_HYBRID_THRESHOLD = 50
const HYBRID_TO_GATE_THRESHOLD = 100

function createState(): SuggesterState {
  return { cleanInvocations: 0, suggestionEmitted: false }
}

export function observeGateResult(sessionId: string, currentMode: EpistemicGateMode, hadViolation: boolean): void {
  if (!store.has(sessionId)) store.set(sessionId, createState())
  const state = store.get(sessionId)!

  if (state.suggestionEmitted) return

  if (hadViolation) {
    state.cleanInvocations = 0
    return
  }

  state.cleanInvocations++

  if (currentMode === "annotation" && state.cleanInvocations >= ANNOTATION_TO_HYBRID_THRESHOLD) {
    log(
      `[epistemic gate-suggest] session ${sessionId}: ${state.cleanInvocations} clean invocations in annotation mode. Consider switching to hybrid.`,
    )
    state.suggestionEmitted = true
  }

  if (currentMode === "hybrid" && state.cleanInvocations >= HYBRID_TO_GATE_THRESHOLD) {
    log(
      `[epistemic gate-suggest] session ${sessionId}: ${state.cleanInvocations} clean invocations in hybrid mode. Consider switching to gate.`,
    )
    state.suggestionEmitted = true
  }
}

export function clearGateSuggester(sessionId: string): void {
  store.delete(sessionId)
}

export function _resetGateSuggesterForTesting(): void {
  store.clear()
}
