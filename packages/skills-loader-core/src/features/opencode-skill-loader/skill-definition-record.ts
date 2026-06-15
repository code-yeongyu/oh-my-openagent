import type { CommandDefinition } from "@oh-my-opencode/claude-code-compat-core/claude-code-command-loader/types"
import type { BuiltinSkill } from "../builtin-skills/types"
import type { LoadedSkill } from "./types"

export function skillsToCommandDefinitionRecord(skills: LoadedSkill[]): Record<string, CommandDefinition> {
  const result: Record<string, CommandDefinition> = {}
  for (const skill of skills) {
    const { name: _name, argumentHint: _argumentHint, ...openCodeCompatible } = skill.definition
    result[skill.name] = openCodeCompatible as CommandDefinition
  }
  return result
}

export function builtinSkillsToCommandDefinitionRecord(
  skills: BuiltinSkill[],
): Record<string, CommandDefinition> {
  const result: Record<string, CommandDefinition> = {}
  for (const skill of skills) {
    result[skill.name] = {
      name: skill.name,
      description: skill.description,
      template: `<skill-instruction>
${skill.template.trim()}
</skill-instruction>

<user-request>
$ARGUMENTS
</user-request>`,
      agent: skill.agent,
      model: skill.model,
      subtask: skill.subtask,
    }
  }
  return result
}
