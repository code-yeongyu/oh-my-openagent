import type { LoadedSkill } from "../types"
import type { SkillDefinition } from "../../../types"
import { deepMerge } from "@oh-my-opencode/utils"
import { parseAllowedTools } from "../allowed-tools-parser"

export function mergeSkillDefinitions(base: LoadedSkill, patch: SkillDefinition): LoadedSkill {
  const mergedMetadata = base.metadata || patch.metadata
    ? deepMerge(base.metadata || {}, (patch.metadata as Record<string, string>) || {})
    : undefined

  const patchAllowedTools = parseAllowedTools(patch["allowed-tools"])
  const mergedTools = base.allowedTools || patchAllowedTools
    ? [...(base.allowedTools || []), ...(patchAllowedTools || [])]
    : undefined

  const description = patch.description || base.definition.description?.replace(/^\([^)]+\) /, "")

  return {
    ...base,
    definition: {
      ...base.definition,
      description: `(${base.scope} - Skill) ${description}`,
      model: patch.model || base.definition.model,
      agent: patch.agent || base.definition.agent,
      subtask: patch.subtask ?? base.definition.subtask,
      argumentHint: patch["argument-hint"] || base.definition.argumentHint,
    },
    license: patch.license || base.license,
    compatibility: patch.compatibility || base.compatibility,
    metadata: mergedMetadata as Record<string, string> | undefined,
    allowedTools: mergedTools ? [...new Set(mergedTools)] : undefined,
  }
}
