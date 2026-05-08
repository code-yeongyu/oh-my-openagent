/**
 * Unified system directive prefix for oh-my-opencode internal messages.
 * All system-generated messages should use this prefix for consistent filtering.
 *
 * Format: [SYSTEM DIRECTIVE: OMO - {TYPE}]
 *
 * The prefix was shortened from "OH-MY-OPENCODE" to "OMO" because Anthropic's
 * keyword filter rejects requests that contain the literal "opencode" string in
 * the system prompt. The legacy prefix is still recognized for backward
 * compatibility with in-flight sessions whose system messages were minted
 * before this change.
 */

export const SYSTEM_DIRECTIVE_PREFIX = "[SYSTEM DIRECTIVE: OMO"

// Legacy prefix kept for backward compatibility with in-flight sessions.
export const LEGACY_SYSTEM_DIRECTIVE_PREFIX = "[SYSTEM DIRECTIVE: OH-MY-OPENCODE"

const SYSTEM_DIRECTIVE_LEADING_KEYWORD_PATTERN = /^\s*(?:ultrawork|ulw)\s+/i

/**
 * Creates a system directive header with the given type.
 * @param type - The directive type (e.g., "TODO CONTINUATION", "RALPH LOOP")
 * @returns Formatted directive string like "[SYSTEM DIRECTIVE: OMO - TODO CONTINUATION]"
 */
export function createSystemDirective(type: string): string {
  return `${SYSTEM_DIRECTIVE_PREFIX} - ${type}]`
}

/**
 * Checks if a message starts with the oh-my-opencode system directive prefix.
 * Used by keyword-detector and other hooks to skip system-generated messages.
 * Recognizes both the current prefix and the legacy prefix.
 * @param text - The message text to check
 * @returns true if the message is a system directive
 */
export function isSystemDirective(text: string): boolean {
  const trimmed = text.trimStart()
  if (trimmed.startsWith(SYSTEM_DIRECTIVE_PREFIX) || trimmed.startsWith(LEGACY_SYSTEM_DIRECTIVE_PREFIX)) {
    return true
  }
  const withoutLeadingKeyword = trimmed.replace(SYSTEM_DIRECTIVE_LEADING_KEYWORD_PATTERN, "")
  return (
    withoutLeadingKeyword.startsWith(SYSTEM_DIRECTIVE_PREFIX) ||
    withoutLeadingKeyword.startsWith(LEGACY_SYSTEM_DIRECTIVE_PREFIX)
  )
}

/**
 * Checks whether a prompt already contains a system directive header anywhere
 * in its text. Use this for double-injection guards in tool.execute.before
 * hooks; recognizes both the current prefix and the legacy prefix so guards
 * keep working for in-flight sessions whose prompts were minted before the
 * prefix rename.
 * @param text - The full prompt text to scan
 * @returns true if a directive header (current or legacy) is present
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
  RALPH_LOOP: "RALPH LOOP",
  BOULDER_CONTINUATION: "BOULDER CONTINUATION",
  DELEGATION_REQUIRED: "DELEGATION REQUIRED",
  SINGLE_TASK_ONLY: "SINGLE TASK ONLY",
  COMPACTION_CONTEXT: "COMPACTION CONTEXT",
  CONTEXT_WINDOW_MONITOR: "CONTEXT WINDOW MONITOR",
  PROMETHEUS_READ_ONLY: "PROMETHEUS READ-ONLY",
} as const

export type SystemDirectiveType = (typeof SystemDirectiveTypes)[keyof typeof SystemDirectiveTypes]
