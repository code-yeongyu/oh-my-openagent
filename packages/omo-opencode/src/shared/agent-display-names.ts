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

// Strip invisible characters that cause TUI mojibake / column-truncation when
// they leak into agent names. The expanded set covers the historical regression
// sources documented in `src/shared/agent-sort-shim.ts` and issue #4170:
//   U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ, U+2060 WORD JOINER,
//   U+FEFF BOM/ZWNBSP, U+00AD SOFT HYPHEN
const INVISIBLE_AGENT_CHARACTERS_REGEX = /[\u00AD\u200B\u200C\u200D\u2060\uFEFF]/g
const VISIBLE_AGENT_LIST_SORT_PREFIX_REGEX = /^\d+\|/
const AGENT_WRAPPER_CHARS_REGEX = /^[\\/"']+|[\\/"']+$/g

export function stripInvisibleAgentCharacters(agentName: string): string {
  return agentName.replace(INVISIBLE_AGENT_CHARACTERS_REGEX, "")
}

export function stripAgentListSortPrefix(agentName: string): string {
  return stripInvisibleAgentCharacters(agentName).replace(VISIBLE_AGENT_LIST_SORT_PREFIX_REGEX, "").replace(AGENT_WRAPPER_CHARS_REGEX, "")
}

/**
 * Normalize a display name for consumption by TUI/HTTP/JSON sinks.
 *
 * Decomposed Unicode (NFD) or stray zero-width characters in the display
 * name surface as mojibake in the OpenCode TUI when the name round-trips
 * through `x-opencode-agent-name`-style sinks (#4170). Normalizing here
 * guarantees every consumer of `getAgentDisplayName` / `getAgentListDisplayName`
 * receives canonical NFC bytes without invisible padding.
 */
function canonicalizeDisplayName(displayName: string): string {
  return stripInvisibleAgentCharacters(displayName).normalize("NFC")
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
  // Check per-agent displayName override first (i18n support)
  if (overrides) {
    const override = overrides[configKey]
      ?? Object.entries(overrides).find(([k]) => k.toLowerCase() === configKey.toLowerCase())?.[1]
    if (override?.displayName) return canonicalizeDisplayName(override.displayName)
  }

  // Try exact match first
  const exactMatch = AGENT_DISPLAY_NAMES[configKey]
  if (exactMatch !== undefined) return canonicalizeDisplayName(exactMatch)

  // Fall back to case-insensitive search
  const lowerKey = configKey.toLowerCase()
  for (const [k, v] of Object.entries(AGENT_DISPLAY_NAMES)) {
    if (k.toLowerCase() === lowerKey) return canonicalizeDisplayName(v)
  }

  // Unknown agent: return original key
  return canonicalizeDisplayName(configKey)
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
  const reversed = REVERSE_DISPLAY_NAMES[lower]
  if (reversed !== undefined) return reversed
  const legacy = LEGACY_DISPLAY_NAMES[lower]
  if (legacy !== undefined) return legacy
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
    return canonicalizeDisplayName(AGENT_DISPLAY_NAMES[configKey] ?? trimmed)
  }

  return canonicalizeDisplayName(trimmed)
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
