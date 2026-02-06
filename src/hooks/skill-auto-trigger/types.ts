import type { SkillScope } from "../../features/opencode-skill-loader/types"

/**
 * Priority mapping for skill scopes.
 * Higher priority skills are suggested first when multiple match.
 */
export const SCOPE_PRIORITY: Record<SkillScope | "builtin" | "config", number> = {
  builtin: 100,
  opencode: 80,
  "opencode-project": 60,
  user: 40,
  project: 20,
  config: 10,
}

/**
 * Represents a dynamically generated skill trigger.
 * Created at plugin load time from skill descriptions.
 */
export interface SkillTrigger {
  /** Skill name for invocation */
  skillName: string
  /** Original skill description */
  description: string
  /** Extracted keywords as RegExp for matching */
  keywords: RegExp
  /** Priority based on skill scope */
  priority: number
  /** Original skill scope */
  scope: SkillScope | "builtin"
}

export const HOOK_NAME = "skill-auto-trigger"
