/**
 * Decide whether the plugin should overwrite a session's title with a friendly
 * fruit-vegetable name.
 *
 * Rules:
 * - Subagent sessions (have a parent) keep their existing title — those are
 *   meaningful (delegate-task summaries, team-mode roles, etc.).
 * - If the user passed a meaningful `--title` we leave it alone. We treat
 *   anything that is not the OpenCode default placeholder, not a truncated
 *   prompt, and not an existing friendly name as "user-set".
 * - Empty / missing titles are always renamed.
 */

const FRIENDLY_NAME_REGEX = /^[a-z]+-[a-z]+(?:-[A-Za-z0-9]+)?$/

const PLACEHOLDER_TITLES = new Set(["", "new session", "untitled", "untitled session"])

export interface ShouldRenameInput {
  isSubagent: boolean
  currentTitle: string | undefined
  /** Maximum length of a "looks like truncated prompt" title to overwrite. */
  truncatedPromptThreshold?: number
}

export function shouldRenameSession(input: ShouldRenameInput): boolean {
  if (input.isSubagent) return false

  const title = (input.currentTitle ?? "").trim()
  const lower = title.toLowerCase()

  if (PLACEHOLDER_TITLES.has(lower)) return true

  // Already a friendly fruit-vegetable name? Leave it (avoid double-renaming
  // when session.created fires more than once).
  if (FRIENDLY_NAME_REGEX.test(title)) return false

  // OpenCode auto-titles short sessions with a truncated prompt. We treat any
  // non-friendly title as user-set unless it is obviously a prompt fragment
  // (contains whitespace AND is short enough to be the truncated prompt).
  const threshold = input.truncatedPromptThreshold ?? 80
  const looksLikeTruncatedPrompt = title.length > 0 && title.length <= threshold && /\s/.test(title)
  return looksLikeTruncatedPrompt
}
