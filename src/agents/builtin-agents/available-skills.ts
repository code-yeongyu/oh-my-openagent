import type { BrowserAutomationProvider } from "../../config/schema"
import { createBuiltinSkills } from "../../features/builtin-skills"
import type { LoadedSkill, SkillScope } from "../../features/opencode-skill-loader/types"
import type { AvailableSkill } from "../dynamic-agent-prompt-builder"

function mapScopeToLocation(scope: SkillScope): AvailableSkill["location"] {
  if (scope === "user" || scope === "opencode") return "user"
  if (scope === "project" || scope === "opencode-project") return "project"
  return "plugin"
}

export function buildAvailableSkills(
  discoveredSkills: LoadedSkill[],
  browserProvider?: BrowserAutomationProvider,
  disabledSkills?: Set<string>,
  currentAgent?: string
): AvailableSkill[] {
  const builtinSkills = createBuiltinSkills({ browserProvider, disabledSkills })
  const builtinSkillNames = new Set(builtinSkills.map(s => s.name))

  const builtinAvailable: AvailableSkill[] = builtinSkills
    .filter((skill) => {
      if (skill.agent && currentAgent && skill.agent !== currentAgent) return false
      return true
    })
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      location: "plugin" as const,
    }))

  const discoveredAvailable: AvailableSkill[] = discoveredSkills
    .filter((s) => {
      if (!builtinSkillNames.has(s.name) && !disabledSkills?.has(s.name)) {
        if (s.definition.agent && currentAgent && s.definition.agent !== currentAgent) return false
        return true
      }
      return false
    })
    .map((skill) => ({
      name: skill.name,
      description: skill.definition.description ?? "",
      location: mapScopeToLocation(skill.scope),
    }))

  return [...builtinAvailable, ...discoveredAvailable]
}
