import type { BuiltinSkill } from "../../builtin-skills/types"
import type { CommandDefinition } from "../../claude-code-command-loader/types"
import type { LoadedSkill } from "../types"

export function builtinToLoadedSkill(builtin: BuiltinSkill): LoadedSkill {
  const definition: CommandDefinition = {
    name: builtin.name,
    description: `(opencode - Skill) ${builtin.description}`,
    template: builtin.template,
    model: builtin.model,
    agent: builtin.agent,
    subtask: builtin.subtask,
    argumentHint: builtin.argumentHint,
  }

  return {
    name: builtin.name,
    definition,
    scope: "builtin",
    license: builtin.license,
    compatibility: builtin.compatibility,
    metadata: builtin.metadata as Record<string, string> | undefined,
    allowedTools: builtin.allowedTools,
    mcpConfig: builtin.mcpConfig,
  }
}
