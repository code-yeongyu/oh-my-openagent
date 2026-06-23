/**
 * Unified system directive prefix for matrixx internal messages.
 * All system-generated messages should use this prefix for consistent filtering.
 *
 * Format: [SYSTEM DIRECTIVE: MATRIXX - {TYPE}]
 */

export const SYSTEM_DIRECTIVE_PREFIX = "[SYSTEM DIRECTIVE: MATRIXX"

/**
 * Creates a system directive header with the given type.
 * @param type - The directive type (e.g., "TODO CONTINUATION", "MATRIX LOOP")
 * @returns Formatted directive string like "[SYSTEM DIRECTIVE: MATRIXX - TODO CONTINUATION]"
 */
export function createSystemDirective(type: string): string {
  return `${SYSTEM_DIRECTIVE_PREFIX} - ${type}]`
}

/**
 * Checks if a message starts with the matrixx system directive prefix.
 * Used by keyword-detector and other hooks to skip system-generated messages.
 * @param text - The message text to check
 * @returns true if the message is a system directive
 */
export function isSystemDirective(text: string): boolean {
  return text.trimStart().startsWith(SYSTEM_DIRECTIVE_PREFIX)
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
  MATRIX_LOOP: "MATRIX LOOP",
  MISSION_CONTINUATION: "MISSION CONTINUATION",
  DELEGATION_REQUIRED: "DELEGATION REQUIRED",
  SINGLE_TASK_ONLY: "SINGLE TASK ONLY",
  COMPACTION_CONTEXT: "COMPACTION CONTEXT",
  CONTEXT_WINDOW_MONITOR: "CONTEXT WINDOW MONITOR",
  PROMETHEUS_READ_ONLY: "PROMETHEUS READ-ONLY",
} as const

