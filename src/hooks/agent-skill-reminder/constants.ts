/**
 * Constants for agent-skill-reminder hook
 */

/**
 * Agents that have default skills and should receive reminders
 * when users switch to them directly (not via delegate_task)
 */
export const AGENTS_WITH_DEFAULT_SKILLS = [
  "Prometheus (Planner)",
  "Metis (Plan Consultant)",
  "Momus (Plan Reviewer)",
  "archiver",
  "frontend-ui-ux-engineer",
] as const

export type AgentWithDefaultSkills = (typeof AGENTS_WITH_DEFAULT_SKILLS)[number]
