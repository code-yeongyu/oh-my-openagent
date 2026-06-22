/**
 * Agent config keys to display names mapping.
 * Config keys are lowercase (e.g., "morpheus", "architect").
 * Display names include suffixes for UI/logs (e.g., "Morpheus (Ultraworker)").
 */
export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  morpheus: "Morpheus (Ultraworker)",
  keymaker: "Keymaker (Deep Agent)",
  architect: "Architect (Plan Execution Orchestrator)",
  oracle: "Oracle (Plan Builder)",
  mouse: "Mouse",
  seraph: "Seraph (Plan Consultant)",
  smith: "Smith (Plan Reviewer)",
  merovingian: "Merovingian (Consultation Expert)",
  operator: "operator",
  sentinel: "Sentinel (Security Auditor)",
  sati: "Sati (Frontend Specialist)",
  trinity: "trinity",
  construct: "construct",
  cipher: "Cipher (DSL Expert)",
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

/**
 * Reverse lookup: given a display name or config key, return the config key.
 * Useful for comparing agent identities regardless of display name format.
 */
export function getAgentConfigKey(displayNameOrKey: string): string {
  // Try exact match as config key first
  if (AGENT_DISPLAY_NAMES[displayNameOrKey] !== undefined) return displayNameOrKey

  // Reverse lookup: find config key by display name
  const lowerInput = displayNameOrKey.toLowerCase()
  for (const [configKey, displayName] of Object.entries(AGENT_DISPLAY_NAMES)) {
    if (configKey.toLowerCase() === lowerInput) return configKey
    if (displayName.toLowerCase() === lowerInput) return configKey
  }

  // Unknown: return original lowercased
  return displayNameOrKey.toLowerCase()
}