const BUILTIN_DISPLAY_NAMES: Record<string, string> = {
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

const customDisplayNames: Record<string, string> = {}

export function registerCustomAgentDisplayNames(names: Record<string, string>): void {
  Object.assign(customDisplayNames, names)
}

export const AGENT_DISPLAY_NAMES: Record<string, string> = BUILTIN_DISPLAY_NAMES

export function getAgentDisplayName(configKey: string): string {
  const exactMatch = customDisplayNames[configKey] ?? BUILTIN_DISPLAY_NAMES[configKey]
  if (exactMatch !== undefined) return exactMatch
  
  const lowerKey = configKey.toLowerCase()
  const allNames = { ...BUILTIN_DISPLAY_NAMES, ...customDisplayNames }
  for (const [k, v] of Object.entries(allNames)) {
    if (k.toLowerCase() === lowerKey) return v
  }
  
  return configKey
}