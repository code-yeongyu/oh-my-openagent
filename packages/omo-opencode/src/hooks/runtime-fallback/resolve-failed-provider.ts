import { parseModelString } from "@oh-my-opencode/model-core"
import { getSessionModel } from "../../shared/session-model-state"
import type { FallbackState } from "./types"

/**
 * Resolve which provider actually failed for a session.
 *
 * The fallback state tracks the currently-active model (including runtime
 * fallbacks), so its provider is the one that just failed. Only when no
 * state exists (or the model string cannot be parsed) do we fall back to
 * the originally stored session model. Event payloads are never consulted —
 * untrusted event provider IDs must not poison another provider.
 */
export function resolveFailedProviderID(sessionID: string, state: FallbackState | undefined): string | undefined {
  const activeProviderID = state ? parseModelString(state.currentModel)?.providerID : undefined
  return activeProviderID ?? getSessionModel(sessionID)?.providerID
}
