/**
 * Per-session temperature overrides.
 *
 * Before prompting a subagent session, store the desired temperature here.
 * The category-temperature chat.params hook reads this store and injects
 * the value into the LLM call parameters.
 */
const temperatureBySession = new Map<string, number>()

export function setSessionTemperature(sessionID: string, temperature: number): void {
  temperatureBySession.set(sessionID, temperature)
}

export function getSessionTemperature(sessionID: string): number | undefined {
  return temperatureBySession.get(sessionID)
}

export function clearSessionTemperature(sessionID: string): void {
  temperatureBySession.delete(sessionID)
}
