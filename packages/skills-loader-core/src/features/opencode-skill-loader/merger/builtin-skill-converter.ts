import { existsSync } from "node:fs"
import { join } from "node:path"
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills"
import type { BuiltinSkill } from "../../builtin-skills/types"
import type { CommandDefinition } from "@oh-my-opencode/claude-code-compat-core/claude-code-command-loader/types"
import type { LoadedSkill } from "../types"

function resolveBuiltinSkillPath(builtin: BuiltinSkill): string | undefined {
  if (builtin.resolvedPath !== undefined) return builtin.resolvedPath

  const sharedSkillPath = join(sharedSkillsRootPath(), builtin.name)
  return existsSync(sharedSkillPath) ? sharedSkillPath : undefined
}

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
    metadata: builtin.metadata,
    allowedTools: builtin.allowedTools,
    mcpConfig: builtin.mcpConfig,
    resolvedPath: resolveBuiltinSkillPath(builtin),
  }
}
