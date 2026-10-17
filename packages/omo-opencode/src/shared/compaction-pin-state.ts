// fix: compaction-pin-checkpoint — tracks the model a session's compaction is
// currently pinned to, so checkpoint capture never mistakes the summarizer's
// model for the session's working model (post-compaction hijack).
type Pin = { providerID: string; modelID: string }

const pins = new Map<string, Pin>()

export function setActiveCompactionPin(sessionID: string, pin: Pin): void {
  pins.set(sessionID, pin)
}

export function getActiveCompactionPin(sessionID: string): Pin | undefined {
  return pins.get(sessionID)
}

export function clearActiveCompactionPin(sessionID: string): void {
  pins.delete(sessionID)
}

export function isActiveCompactionPin(
  sessionID: string,
  model: { providerID?: string; modelID?: string } | undefined,
): boolean {
  const pin = pins.get(sessionID)
  return !!pin && !!model?.providerID && !!model?.modelID && pin.providerID === model.providerID && pin.modelID === model.modelID
}
