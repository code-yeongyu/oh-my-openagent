/**
 * Team mode keyword detector.
 *
 * Triggers when the user explicitly invokes team-mode work:
 * - English: team mode, team-mode, team_mode, teammode (case-insensitive)
 * - Korean: 팀 모드, 팀모드, 팀으로
 *
 * The Korean variants use a negative lookbehind on Hangul syllables (가-힣)
 * to prevent false positives like "스팀으로" matching "팀으로", or
 * "스팀모드" matching "팀모드".
 */

export const TEAM_PATTERN =
  /\bteam[\s_-]?mode\b|(?<![가-힣])(?:팀\s*모드|팀으로)/i

export const TEAM_MESSAGE = `[team-mode]
Team mode reference detected. If user wants team-mode work, MUST orchestrate via team_* tools (team_create -> team_task_create + team_send_message). NEVER substitute with delegate_task - it is not equivalent. If team_* tools are unavailable (team_mode disabled in config), instruct user to set team_mode.enabled=true and restart opencode.`
