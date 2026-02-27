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

let userOverrides: Record<string, string> | undefined

/**
 * Apply user-defined display name overrides from config.
 * Call once during plugin initialization, before config pipeline runs.
 */
export function applyUserDisplayNames(overrides: Record<string, string>): void {
  userOverrides = Object.fromEntries(
    Object.entries(overrides).map(([k, v]) => [k.toLowerCase(), v]),
  )
}

export function resetUserDisplayNames(): void {
  userOverrides = undefined
}

export function isUserDisplayNamesActive(): boolean {
  return userOverrides !== undefined
}

/**
 * Get display name for an agent config key.
 * Uses case-insensitive lookup for backward compatibility.
 * Returns original key if not found.
 */
export function getAgentDisplayName(configKey: string): string {
  const lowerKey = configKey.toLowerCase()
  const userOverride = userOverrides?.[lowerKey]
  if (userOverride !== undefined) return userOverride

  const exactMatch = AGENT_DISPLAY_NAMES[configKey]
  if (exactMatch !== undefined) return exactMatch

  for (const [k, v] of Object.entries(AGENT_DISPLAY_NAMES)) {
    if (k.toLowerCase() === lowerKey) return v
  }

  return configKey
}

const REVERSE_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(AGENT_DISPLAY_NAMES).map(([key, displayName]) => [displayName.toLowerCase(), key]),
)

/**
 * Resolve an agent name (display name or config key) to its lowercase config key.
 * "Atlas (Plan Executor)" → "atlas", "atlas" → "atlas", "unknown" → "unknown"
 */
export function getAgentConfigKey(agentName: string): string {
  const lower = agentName.toLowerCase()
  if (userOverrides) {
    for (const [configKey, displayName] of Object.entries(userOverrides)) {
      if (displayName.toLowerCase() === lower) return configKey
    }
  }
  const reversed = REVERSE_DISPLAY_NAMES[lower]
  if (reversed !== undefined) return reversed
  if (AGENT_DISPLAY_NAMES[lower] !== undefined) return lower
  return lower
}