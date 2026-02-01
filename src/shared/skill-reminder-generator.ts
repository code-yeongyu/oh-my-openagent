/**
 * Skill Reminder Generator
 *
 * Generates reminder text for agent defaultSkills.
 * Used by delegate_task and agent-skill-reminder hook.
 *
 * Design Decision: "Reminder over Injection"
 * - defaultSkills only generate reminders (not full content injection)
 * - Full content injection only happens when user explicitly passes `skills` parameter
 */

import { AGENT_DEFAULT_SKILLS } from "../tools/delegate-task/constants"

/** Skill description mapping for reminder generation */
const SKILL_DESCRIPTIONS: Record<string, string> = {
  brainstorming:
    "Explore user intent, requirements, and design before creating any plan",
  "creating-changes":
    "Write design.md and tasks.md after brainstorming is complete",
  "dispatching-parallel-agents":
    "Use when facing 2+ independent tasks that can be worked on in parallel",
  "collaborating-with-codex":
    "Delegate coding tasks to Codex CLI for prototyping, debugging, and code review",
  "collaborating-with-gemini":
    "Delegate coding tasks to Gemini CLI for prototyping, debugging, and code review",
  "verification-before-completion":
    "Verify deliverables meet acceptance criteria before handoff",
  "finishing-a-development-branch":
    "Guide completion of development work with merge/PR/cleanup options",
  "archiving-changes": "Archive completed changes to changes/archive/",
  "frontend-ui-ux":
    "Designer-turned-developer approach for stunning UI/UX work",
  playwright:
    "Browser automation via Playwright MCP - testing, screenshots, scraping",
  tdd: "Test-Driven Development - RED-GREEN-REFACTOR workflow",
  "systematic-debugging":
    "Systematic debugging approach before proposing fixes",
  "git-master":
    "Git expert for atomic commits, rebase/squash, history search",
  "executing-plans":
    "Execute implementation plans with review checkpoints (sequential mode)",
  "wave-parallel-execution":
    "Execute plans with multiple independent waves in parallel",
}

/**
 * Get default skills for an agent
 */
export function getAgentDefaultSkills(agentName: string): string[] {
  return AGENT_DEFAULT_SKILLS[agentName] ?? []
}

/**
 * Generate skill reminder text for an agent.
 *
 * @param agentName - The agent name (e.g., "Prometheus (Planner)")
 * @param skills - Array of skill names to include in reminder
 * @returns Formatted markdown reminder text, or empty string if no skills
 */
export function generateSkillReminder(
  agentName: string,
  skills: string[]
): string {
  if (!skills || skills.length === 0) {
    return ""
  }

  const skillRows = skills
    .map((skill) => {
      const description =
        SKILL_DESCRIPTIONS[skill] ?? "Specialized skill for this task"
      return `| \`${skill}\` | ${description} |`
    })
    .join("\n")

  return `## 🔧 Available Skills for ${agentName}

| Skill | When to Use |
|-------|-------------|
${skillRows}

**Usage**: \`skill("skill-name")\`

⚠️ **MANDATORY**: Call relevant skills before starting work. Skills contain critical workflow guidance.`
}

/**
 * Generate skill reminder for an agent using its default skills.
 *
 * @param agentName - The agent name
 * @returns Formatted reminder text, or empty string if agent has no default skills
 */
export function generateAgentSkillReminder(agentName: string): string {
  const defaultSkills = getAgentDefaultSkills(agentName)
  return generateSkillReminder(agentName, defaultSkills)
}

/**
 * Check if skills are from defaultSkills (not user-specified).
 * Used to determine whether to inject full content or just reminder.
 *
 * @param agentName - The agent name
 * @param skills - Skills to check
 * @returns true if all skills are from defaultSkills
 */
export function areDefaultSkillsOnly(
  agentName: string,
  skills: string[]
): boolean {
  const defaultSkills = getAgentDefaultSkills(agentName)
  if (skills.length === 0) return true
  return skills.every((skill) => defaultSkills.includes(skill))
}
