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

export const TEAM_MESSAGE = `[团队模式]
检测到团队模式引用。如果用户想要团队模式工作，必须通过 team_* 工具进行编排（team_create -> team_task_create + team_send_message）。绝不要用 delegate_task 替代 —— 两者不等同。如果 team_* 工具不可用（配置中禁用了 team_mode），请指导用户在配置中设置 team_mode.enabled=true 并重新启动 opencode。`
