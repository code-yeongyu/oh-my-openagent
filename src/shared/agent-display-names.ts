export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  sisyphus: "Sisyphus (Ultraworker)",
  atlas: "Atlas (Plan Execution Orchestrator)",
  prometheus: "Prometheus (Plan Builder)",
  "sisyphus-junior": "Sisyphus-Junior",
  metis: "Metis (Plan Consultant)",
  momus: "Momus (Plan Reviewer)",
  oracle: "oracle",
  librarian: "librarian",
  explore: "explore",
  "multimodal-looker": "multimodal-looker",
}

let userOverrides: Record<string, string> = {}

export function initializeAgentDisplayNames(overrides: Record<string, string>): void {
  userOverrides = overrides
}

export function resetAgentDisplayNames(): void {
  userOverrides = {}
}

export function getAgentDisplayName(configKey: string): string {
  const lowerKey = configKey.toLowerCase()
  
  for (const [k, v] of Object.entries(userOverrides)) {
    if (k.toLowerCase() === lowerKey) return v
  }
  
  const exactMatch = AGENT_DISPLAY_NAMES[configKey]
  if (exactMatch !== undefined) return exactMatch
  
  for (const [k, v] of Object.entries(AGENT_DISPLAY_NAMES)) {
    if (k.toLowerCase() === lowerKey) return v
  }
  
  return configKey
}