import type { SkillTriggerCache } from "./types"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"

/**
 * Simple hash function for change detection.
 * Uses a fast string hash algorithm (djb2).
 */
export function hashDescription(description: string): string {
  let hash = 5381
  for (let i = 0; i < description.length; i++) {
    hash = ((hash << 5) + hash) + description.charCodeAt(i)
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16)
}

export interface UpdateCheckResult {
  /** Skills that are new (not in cache) */
  newSkills: LoadedSkill[]
  /** Skills whose description has changed */
  changedSkills: LoadedSkill[]
  /** Skill names that were deleted (in cache but not current) */
  deletedSkills: string[]
  /** Whether any updates are needed */
  hasUpdates: boolean
}

/**
 * Check for updates between cache and current skills.
 */
export function checkForUpdates(
  cache: SkillTriggerCache,
  currentSkills: LoadedSkill[]
): UpdateCheckResult {
  const newSkills: LoadedSkill[] = []
  const changedSkills: LoadedSkill[] = []
  
  const currentSkillNames = new Set<string>()
  
  for (const skill of currentSkills) {
    const description = skill.definition?.description
    if (!description) continue
    
    currentSkillNames.add(skill.name)
    const currentHash = hashDescription(description)
    const cached = cache.skills[skill.name]
    
    if (!cached) {
      newSkills.push(skill)
    } else if (cached.hash !== currentHash) {
      changedSkills.push(skill)
    }
  }
  
  // Find deleted skills
  const deletedSkills = Object.keys(cache.skills)
    .filter(name => !currentSkillNames.has(name))
  
  return {
    newSkills,
    changedSkills,
    deletedSkills,
    hasUpdates: newSkills.length > 0 || changedSkills.length > 0 || deletedSkills.length > 0
  }
}
