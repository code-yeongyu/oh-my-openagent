import type { SkillScope } from "../../features/opencode-skill-loader/types"

/**
 * Priority mapping for skill scopes.
 * Higher priority skills are suggested first when multiple match.
 */
export const SCOPE_PRIORITY: Record<SkillScope | "builtin" | "config", number> = {
  builtin: 100,
  "opencode-project": 80,  // Project-level skills take precedence
  opencode: 60,
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

/**
 * Cached skill trigger with hash for change detection
 */
export interface CachedSkillTrigger {
  /** Hash of the skill description for change detection */
  hash: string
  /** Extracted trigger words */
  triggers: string[]
  /** Priority based on skill scope */
  priority: number
  /** Original skill scope */
  scope: SkillScope | "builtin"
}

/**
 * Cache file structure for skill triggers
 */
export interface SkillTriggerCache {
  /** Cache format version */
  version: string
  /** ISO timestamp when cache was generated */
  generatedAt: string
  /** Map of skill name to cached trigger data */
  skills: Record<string, CachedSkillTrigger>
}

/**
 * Empty cache constant
 */
export const EMPTY_CACHE: SkillTriggerCache = {
  version: "1.0",
  generatedAt: "",
  skills: {}
}

export const HOOK_NAME = "skill-auto-trigger"
