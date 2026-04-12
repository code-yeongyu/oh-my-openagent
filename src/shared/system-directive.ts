/**
 * Unified system directive prefix for oh-my-opencode internal messages.
 * All system-generated messages should use this prefix for consistent filtering.
 *
 * Format: [SYSTEM DIRECTIVE: OH-MY-OPENCODE - {TYPE}]
 */

export const SYSTEM_DIRECTIVE_PREFIX = "[SYSTEM DIRECTIVE: OH-MY-OPENCODE"
const LEGACY_MARKDOWN_REMINDER_PATTERN = /---[\s\S]*?---/gi
const SYSTEM_REMINDER_TAG_PATTERN = /<system-reminder>[\s\S]*?<\/system-reminder>/gi
const SYSTEM_DIRECTIVE_TAG_PATTERN = /<system-directive>[\s\S]*?<\/system-directive>/gi
const INTERNAL_INITIATOR_COMMENT_PATTERN = /<!--\s*OMO_INTERNAL_INITIATOR\s*-->/gi
const INTERNAL_INITIATOR_TEXT_PATTERN = /\[OMO_INTERNAL\]/g

function matchesPattern(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0
  return pattern.test(text)
}

/**
 * Creates a system directive header with the given type.
 * @param type - The directive type (e.g., "TODO CONTINUATION", "RALPH LOOP")
 * @returns Formatted directive string like "[SYSTEM DIRECTIVE: OH-MY-OPENCODE - TODO CONTINUATION]"
 */
export function createSystemDirective(type: string): string {
  return `${SYSTEM_DIRECTIVE_PREFIX} - ${type}]`
}

/**
 * Checks if a message starts with the oh-my-opencode system directive prefix.
 * Used by keyword-detector and other hooks to skip system-generated messages.
 * @param text - The message text to check
 * @returns true if the message is a system directive
 */
export function isSystemDirective(text: string): boolean {
  return text.trimStart().startsWith(SYSTEM_DIRECTIVE_PREFIX)
}

/**
 * Checks if a message contains system-generated content that should be excluded
 * from keyword detection and mode triggering.
 * @param text - The message text to check
 * @returns true if the message contains system-directive tags
 */
export function hasSystemReminder(text: string): boolean {
  return (
    matchesPattern(LEGACY_MARKDOWN_REMINDER_PATTERN, text) ||
    matchesPattern(SYSTEM_REMINDER_TAG_PATTERN, text) ||
    matchesPattern(SYSTEM_DIRECTIVE_TAG_PATTERN, text) ||
    matchesPattern(INTERNAL_INITIATOR_COMMENT_PATTERN, text) ||
    matchesPattern(INTERNAL_INITIATOR_TEXT_PATTERN, text)
  )
}

/**
 * Removes system-directive tag content from text.
 * This prevents automated system messages from triggering mode keywords.
 * @param text - The message text to clean
 * @returns text with system-directive content removed
 */
export function removeSystemReminders(text: string): string {
  return text
    .replace(SYSTEM_REMINDER_TAG_PATTERN, "")
    .replace(SYSTEM_DIRECTIVE_TAG_PATTERN, "")
    .replace(LEGACY_MARKDOWN_REMINDER_PATTERN, "")
    .replace(INTERNAL_INITIATOR_COMMENT_PATTERN, "")
    .replace(INTERNAL_INITIATOR_TEXT_PATTERN, "")
    .trim()
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
