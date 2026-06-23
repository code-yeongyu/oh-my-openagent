import { getMultiPlaneAnnotations } from "../../hooks/epistemic-state-interpreter/annotation-store-v2"
import {
  deriveAspicPreferences,
  injectDerivedPreferences,
} from "../../hooks/epistemic-state-interpreter/preference-injection-v2"
import { log } from "../../shared/logger"

export function injectStoredPreferences(
  sessionID: string,
  theory: Record<string, unknown>,
): number {
  const annotations = getMultiPlaneAnnotations(sessionID)
  if (annotations.length === 0) {
    return 0
  }

  const result = deriveAspicPreferences(annotations)
  if (result.injected.length === 0) {
    return 0
  }

  injectDerivedPreferences(theory, result)

  log("[epistemic-v2] pre-injection: derived preferences injected", {
    sessionID,
    annotationCount: annotations.length,
    preferencesInjected: result.injected.length,
    blocked: result.blocked,
  })

  return result.injected.length
}
