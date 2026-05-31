import { TEAM_MODE_PROMPT } from "@oh-my-opencode/prompts-core"

/**
 * Team mode keyword detector.
 *
 * Triggers when the user explicitly invokes team-mode work:
 *   team mode, team-mode, team_mode, teammode (case-insensitive)
 */

export const TEAM_PATTERN = /\bteam[\s_-]?mode\b/i

export const TEAM_MESSAGE = TEAM_MODE_PROMPT
