export interface PendingSwitch {
  agent: string
  context: string
}

const pendingSwitches = new Map<string, PendingSwitch>()

export function setPendingSwitch(sessionID: string, agent: string, context: string): void {
  pendingSwitches.set(sessionID, { agent, context })
}

export function consumePendingSwitch(sessionID: string): PendingSwitch | undefined {
  const entry = pendingSwitches.get(sessionID)
  if (entry) {
    pendingSwitches.delete(sessionID)
  }
  return entry
}

/** @internal For testing only */
export function _resetForTesting(): void {
  pendingSwitches.clear()
}
