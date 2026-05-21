import type { AvailableSkill } from "../dynamic-agent-prompt-builder"
import type { BrowserAutomationProvider } from "../../config/schema"
import type { LoadedSkill, SkillScope } from "../../features/opencode-skill-loader/types"
import { createBuiltinSkills } from "../../features/builtin-skills"

function mapScopeToLocation(scope: SkillScope): AvailableSkill["location"] {
  if (scope === "user" || scope === "opencode") return "user"
  if (scope === "project" || scope === "opencode-project") return "project"
  return "plugin"
}

export function buildAvailableSkills(
  discoveredSkills: LoadedSkill[],
  browserProvider?: BrowserAutomationProvider,
  disabledSkills?: Set<string>,
  teamModeEnabled?: boolean,
  agentName?: string,
): AvailableSkill[] {
  const builtinSkills = createBuiltinSkills({ browserProvider, disabledSkills, teamModeEnabled })
  const builtinSkillNames = new Set(builtinSkills.map(s => s.name))

  const builtinAvailable: AvailableSkill[] = builtinSkills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    location: "plugin" as const,
  }))

  const discoveredAvailable: AvailableSkill[] = discoveredSkills
    .filter(s => {
      if (builtinSkillNames.has(s.name) || disabledSkills?.has(s.name)) return false
      // If the skill declares an agent restriction and we know the current agent,
      // exclude skills that don't belong to this agent.
      if (agentName && s.definition.agent && s.definition.agent !== agentName) return false
      return true
    })
    .map((skill) => ({
      name: skill.name,
      description: skill.definition.description ?? "",
      location: mapScopeToLocation(skill.scope),
    }))

  return [...builtinAvailable, ...discoveredAvailable]
}
