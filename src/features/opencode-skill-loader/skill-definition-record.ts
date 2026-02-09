import type { CommandDefinition } from "../claude-code-command-loader/types"
import type { LoadedSkill } from "./types"

export function skillsToCommandDefinitionRecord(skills: LoadedSkill[]): Record<string, CommandDefinition> {
  const result: Record<string, CommandDefinition> = {}
  for (const skill of skills) {
    const { name: _name, argumentHint: _argumentHint, ...openCodeCompatible } = skill.definition
    result[skill.name] = openCodeCompatible as CommandDefinition
  }
  return result
}
