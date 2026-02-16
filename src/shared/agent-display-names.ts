/**
 * Agent config keys to display names mapping.
 * Config keys are lowercase (e.g., "sisyphus", "atlas").
 * Display names include suffixes for UI/logs (e.g., "Sisyphus (Ultraworker)").
 */
export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  sisyphus: "Sisyphus (Ultraworker)",
  hephaestus: "Hephaestus (Deep Agent)",
  prometheus: "Prometheus (Plan Builder)",
  atlas: "Atlas (Plan Executor)",
  "sisyphus-junior": "Sisyphus-Junior",
  metis: "Metis (Plan Consultant)",
  momus: "Momus (Plan Critic)",
  oracle: "oracle",
  librarian: "librarian",
  explore: "explore",
  "multimodal-looker": "multimodal-looker",
}

/**
 * Get display name for an agent config key.
 * Uses case-insensitive lookup for backward compatibility.
 * Returns original key if not found.
 */
export function getAgentDisplayName(configKey: string): string {
  // Try exact match first
  const exactMatch = AGENT_DISPLAY_NAMES[configKey]
  if (exactMatch !== undefined) return exactMatch
  
  // Fall back to case-insensitive search
  const lowerKey = configKey.toLowerCase()
  for (const [k, v] of Object.entries(AGENT_DISPLAY_NAMES)) {
    if (k.toLowerCase() === lowerKey) return v
  }
  
  // Unknown agent: return original key
  return configKey
}