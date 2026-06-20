import { existsSync } from "node:fs"
import { join } from "node:path"
import type { BuiltinSkill } from "../../builtin-skills/types"
import { getSharedSkillSourceDir, getBuiltinSkillSourceDir } from "../../builtin-skills/skill-file-loader"
import type { CommandDefinition } from "@oh-my-opencode/claude-code-compat-core/claude-code-command-loader/types"
import type { LoadedSkill } from "../types"

function inferBuiltinSourceDir(name: string): string | undefined {
  const sharedDir = getSharedSkillSourceDir(name)
  if (existsSync(join(sharedDir, "SKILL.md"))) return sharedDir

  const builtinDir = getBuiltinSkillSourceDir(name)
  if (existsSync(builtinDir)) return builtinDir

  return undefined
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
    resolvedPath: builtin.sourceDir ?? inferBuiltinSourceDir(builtin.name),
    license: builtin.license,
    compatibility: builtin.compatibility,
    metadata: builtin.metadata as Record<string, string> | undefined,
    allowedTools: builtin.allowedTools,
    mcpConfig: builtin.mcpConfig,
  }
}
