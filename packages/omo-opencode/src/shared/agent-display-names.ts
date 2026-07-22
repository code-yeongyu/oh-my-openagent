import { AGENT_NAME_MAP } from "./migration"

/**
 * Agent config keys to display names mapping.
 * Config keys are lowercase (e.g., "sisyphus", "atlas").
 * Display names include suffixes for UI/logs (e.g., "Sisyphus - Ultraworker").
 *
 * IMPORTANT: Display names MUST NOT contain parentheses or other characters
 * that are invalid in HTTP header values per RFC 7230. OpenCode passes the
 * agent name in the `x-opencode-agent-name` header, and parentheses cause
 * header validation failures that prevent agents from appearing in the UI
 * type selector dropdown. Use ` - ` (space-dash-space) instead of `(...)`.
 */
export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  sisyphus: "Sisyphus - ultraworker",
  hephaestus: "Hephaestus - Deep Agent",
  prometheus: "Prometheus - Plan Builder",
  atlas: "Atlas - Plan Executor",
  "sisyphus-junior": "Sisyphus-Junior",
  metis: "Metis - Plan Consultant",
  momus: "Momus - Plan Critic",
  athena: "Athena - Council",
  "athena-junior": "Athena-Junior - Council",
  oracle: "oracle",
  librarian: "librarian",
  explore: "explore",
  "multimodal-looker": "multimodal-looker",
  "council-member": "council-member",
}

const INVISIBLE_AGENT_CHARACTERS_REGEX = /[\u200B\u200C\u200D\uFEFF]/g
const VISIBLE_AGENT_LIST_SORT_PREFIX_REGEX = /^\d+\|/
const AGENT_WRAPPER_CHARS_REGEX = /^[\\/"']+|[\\/"']+$/g

export function stripInvisibleAgentCharacters(agentName: string): string {
  return agentName.replace(INVISIBLE_AGENT_CHARACTERS_REGEX, "")
}

export function stripAgentListSortPrefix(agentName: string): string {
  return stripInvisibleAgentCharacters(agentName).replace(VISIBLE_AGENT_LIST_SORT_PREFIX_REGEX, "").replace(AGENT_WRAPPER_CHARS_REGEX, "")
}

/**
 * Get display name for an agent config key.
 * Uses case-insensitive lookup for backward compatibility.
 * Returns original key if not found.
 *
 * @param overrides - Optional per-agent overrides map. If the agent has a `displayName`
 *   field set, it takes precedence over the hardcoded AGENT_DISPLAY_NAMES entry.
 *   This enables i18n: `agents.sisyphus.displayName = "总指挥"` in oh-my-openagent.json.
 */
export function getAgentDisplayName(
  configKey: string,
  overrides?: Record<string, { displayName?: string } | undefined>,
): string {
  const canonConfigKey = AGENT_NAME_MAP[configKey.toLowerCase()] ?? AGENT_NAME_MAP[configKey] ?? configKey
  // Check per-agent displayName override first (i18n support)
  if (overrides) {
    const override = overrides[canonConfigKey]
      ?? overrides[configKey]
      ?? Object.entries(overrides).find(([k]) => {
           const canonK = AGENT_NAME_MAP[k.toLowerCase()] ?? AGENT_NAME_MAP[k] ?? k
           return canonK.toLowerCase() === canonConfigKey.toLowerCase()
         })?.[1]
    if (override?.displayName) return override.displayName
  }

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
 * Thin alias for `getAgentDisplayName` preserved for external imports.
 *
 * Earlier versions injected zero-width prefixes here to bias OpenCode's
 * `agent.name` sort. Sort ordering is now enforced by
 * `src/shared/agent-sort-shim.ts`, so this function emits the canonical
 * display name verbatim. Kept exported because downstream modules still
 * import this symbol; do not collapse the call sites without coordinating.
 */
export function getAgentListDisplayName(
  configKey: string,
  overrides?: Record<string, { displayName?: string } | undefined>,
): string {
  return getAgentDisplayName(configKey, overrides)
}

/**
 * Module-level registries for override display names.
 * Must be populated before assembly-time reverse lookups (e.g. inside `applyAgentConfig()`
 * before `assembleAgentConfig()`), with `finalizeAgentConfig()` serving as an idempotent safety net.
 * This allows reverse lookups (display name → config key) to resolve user-configured custom
 * display names (e.g., CJK i18n names) back to their canonical config keys.
 *
 * `overrideDisplayNames`: lowercased override display name → lowercase config key (reverse lookup)
 * `overrideConfigKeyToDisplayName`: lowercase config key → override display name (forward lookup for normalizeAgentForPrompt)
 */
const overrideDisplayNames = new Map<string, string>()
const overrideConfigKeyToDisplayName = new Map<string, string>()

/**
 * Populate the override display-name registry from the plugin config's agent overrides.
 * Must be called before assembly-time reverse lookups (e.g. inside `applyAgentConfig()`),
 * with `finalizeAgentConfig()` serving as an idempotent safety net.
 * Override keys are resolved to canonical lowercase config keys using `AGENT_NAME_MAP`.
 *
 * @param agents - The `agents` section of the plugin config, keyed by config key.
 *   Each value may contain a `displayName` override.
 */
export function setOverrideDisplayNames(
  agents?: Record<string, { displayName?: string } | undefined>,
): void {
  overrideDisplayNames.clear()
  overrideConfigKeyToDisplayName.clear()
  if (!agents) return
  for (const [configKey, override] of Object.entries(agents)) {
    if (override?.displayName) {
      const canonicalKey = (AGENT_NAME_MAP[configKey.toLowerCase()] ?? AGENT_NAME_MAP[configKey] ?? configKey).toLowerCase()
      overrideDisplayNames.set(override.displayName.toLowerCase(), canonicalKey)
      overrideConfigKeyToDisplayName.set(canonicalKey, override.displayName)
    }
  }
}

/**
 * Reset the override registry to empty. For test isolation only.
 */
export function _resetOverrideDisplayNamesForTesting(): void {
  overrideDisplayNames.clear()
  overrideConfigKeyToDisplayName.clear()
}

const REVERSE_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(AGENT_DISPLAY_NAMES).map(([key, displayName]) => [displayName.toLowerCase(), key]),
)

// Legacy parenthesized display names for backward compatibility.
// Old configs/sessions may reference these names; resolve them to config keys.
const LEGACY_DISPLAY_NAMES: Record<string, string> = {
  "sisyphus (ultraworker)": "sisyphus",
  "hephaestus (deep agent)": "hephaestus",
  "prometheus (plan builder)": "prometheus",
  "atlas (plan executor)": "atlas",
  "metis (plan consultant)": "metis",
  "momus (plan critic)": "momus",
  "athena (council)": "athena",
  "athena-junior (council)": "athena-junior",
}

function resolveKnownAgentConfigKey(agentName: string): string | undefined {
  const lower = stripAgentListSortPrefix(agentName).trim().toLowerCase()
  // Check override display names first (user-configured i18n names)
  const override = overrideDisplayNames.get(lower)
  if (override !== undefined) return override
  const reversed = REVERSE_DISPLAY_NAMES[lower]
  if (reversed !== undefined) return reversed
  const legacy = LEGACY_DISPLAY_NAMES[lower]
  if (legacy !== undefined) return legacy
  const canonical = AGENT_NAME_MAP[lower]
  if (canonical !== undefined) return canonical
  if (AGENT_DISPLAY_NAMES[lower] !== undefined) return lower
  return undefined
}

/**
 * Resolve an agent name (display name or config key) to its lowercase config key.
 * "Atlas - Plan Executor" -> "atlas", "Atlas (Plan Executor)" -> "atlas", "atlas" -> "atlas"
 */
export function getAgentConfigKey(agentName: string): string {
  const lower = stripAgentListSortPrefix(agentName).trim().toLowerCase()
  return resolveKnownAgentConfigKey(agentName) ?? lower
}

/**
 * Normalize an agent name for prompt APIs.
 * - Known display names -> canonical display names
 * - Known config keys (any case) -> canonical display names
 * - Unknown/custom names -> preserved as-is (trimmed)
 */
export function normalizeAgentForPrompt(agentName: string | undefined): string | undefined {
  if (typeof agentName !== "string") {
    return undefined
  }

  const trimmed = stripAgentListSortPrefix(agentName).trim()
  if (!trimmed) {
    return undefined
  }

  const configKey = resolveKnownAgentConfigKey(trimmed)
  if (configKey !== undefined) {
    // Check override forward map first (user-configured i18n names)
    const overrideName = overrideConfigKeyToDisplayName.get(configKey)
    if (overrideName !== undefined) return overrideName
    return AGENT_DISPLAY_NAMES[configKey] ?? trimmed
  }

  return trimmed
}

export function normalizeAgentForPromptKey(agentName: string | undefined): string | undefined {
  if (typeof agentName !== "string") {
    return undefined
  }

  const trimmed = stripAgentListSortPrefix(agentName).trim()
  if (!trimmed) {
    return undefined
  }

  return resolveKnownAgentConfigKey(trimmed) ?? trimmed
}
