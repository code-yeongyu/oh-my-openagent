/**
 * Unified system directive prefix for oh-my-openagent internal messages.
 * All system-generated messages should use this prefix for consistent filtering.
 *
 * Format: [SYSTEM DIRECTIVE: OH-MY-OPENAGENT - {TYPE}]
 *
 * The prefix must never contain the literal "opencode": Anthropic-side request
 * filtering rejects outbound payloads carrying it (issue #3435).
 */

export const SYSTEM_DIRECTIVE_PREFIX = "[SYSTEM DIRECTIVE: OH-MY-OPENAGENT"

/**
 * Pre-rename directive prefix, recognized for compatibility with directives
 * already persisted in in-flight sessions. Never emitted; recognition only.
 */
export const LEGACY_SYSTEM_DIRECTIVE_PREFIX = "[SYSTEM DIRECTIVE: OH-MY-OPENCODE"

const SYSTEM_DIRECTIVE_LEADING_KEYWORD_PATTERN = /^\s*(?:ultrawork|ulw)\s+/i

/**
 * Creates a system directive header with the given type.
 * @param type - The directive type (e.g., "TODO CONTINUATION", "RALPH LOOP")
 * @returns Formatted directive string like "[SYSTEM DIRECTIVE: OH-MY-OPENAGENT - TODO CONTINUATION]"
 */
export function createSystemDirective(type: string): string {
  return `${SYSTEM_DIRECTIVE_PREFIX} - ${type}]`
}

function startsWithAnyDirectivePrefix(text: string): boolean {
  return text.startsWith(SYSTEM_DIRECTIVE_PREFIX) || text.startsWith(LEGACY_SYSTEM_DIRECTIVE_PREFIX)
}

/**
 * Checks if a message starts with an oh-my-openagent system directive prefix
 * (current or legacy). Used by keyword-detector and other hooks to skip
 * system-generated messages.
 * @param text - The message text to check
 * @returns true if the message is a system directive
 */
export function isSystemDirective(text: string): boolean {
  const trimmed = text.trimStart()
  if (startsWithAnyDirectivePrefix(trimmed)) {
    return true
  }
  const withoutLeadingKeyword = trimmed.replace(SYSTEM_DIRECTIVE_LEADING_KEYWORD_PATTERN, "")
  return startsWithAnyDirectivePrefix(withoutLeadingKeyword)
}

/**
 * Checks if a message contains a system directive header anywhere (current or
 * legacy prefix). Used by double-injection guards before appending directives.
 * @param text - The message text to check
 * @returns true if the message contains a system directive header
 */
export function containsSystemDirective(text: string): boolean {
  return text.includes(SYSTEM_DIRECTIVE_PREFIX) || text.includes(LEGACY_SYSTEM_DIRECTIVE_PREFIX)
}

/**
 * Checks if a message contains system-generated content that should be excluded
 * from keyword detection and mode triggering.
 * @param text - The message text to check
 * @returns true if the message contains system-reminder tags
 */
export function hasSystemReminder(text: string): boolean {
  return /<system-reminder>[\s\S]*?<\/system-reminder>/i.test(text)
}

/**
 * Removes system-reminder tag content from text.
 * This prevents automated system messages from triggering mode keywords.
 * @param text - The message text to clean
 * @returns text with system-reminder content removed
 */
export function removeSystemReminders(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "").trim()
}

export const SystemDirectiveTypes = {
  TODO_CONTINUATION: "TODO CONTINUATION",
  BOULDER_CONTINUATION: "BOULDER CONTINUATION",
  DELEGATION_REQUIRED: "DELEGATION REQUIRED",
  SINGLE_TASK_ONLY: "SINGLE TASK ONLY",
  COMPACTION_CONTEXT: "COMPACTION CONTEXT",
  CONTEXT_WINDOW_MONITOR: "CONTEXT WINDOW MONITOR",
  PROMETHEUS_READ_ONLY: "PROMETHEUS READ-ONLY",
} as const

export type SystemDirectiveType = (typeof SystemDirectiveTypes)[keyof typeof SystemDirectiveTypes]
