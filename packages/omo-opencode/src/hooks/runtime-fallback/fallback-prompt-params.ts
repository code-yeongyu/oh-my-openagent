import type { SessionPromptParams } from "../../shared/session-prompt-params-state"
import {
  clearSessionPromptParams,
  getSessionPromptParams,
  setSessionPromptParams,
} from "../../shared/session-prompt-params-state"

type PromptParamSnapshots = Map<string, SessionPromptParams | undefined>

export function capturePromptParams(
  snapshots: PromptParamSnapshots | undefined,
  sessionID: string,
): boolean {
  if (!snapshots || snapshots.has(sessionID)) return false
  snapshots.set(sessionID, getSessionPromptParams(sessionID))
  return true
}

export function restorePromptParams(
  snapshots: PromptParamSnapshots | undefined,
  sessionID: string,
): void {
  if (!snapshots?.has(sessionID)) return
  const original = snapshots.get(sessionID)
  if (original) setSessionPromptParams(sessionID, original)
  else clearSessionPromptParams(sessionID)
  snapshots.delete(sessionID)
}

export function discardPromptParamsSnapshot(
  snapshots: PromptParamSnapshots | undefined,
  sessionID: string,
): void {
  snapshots?.delete(sessionID)
}
