import type { LoadedSkill } from "../../features/opencode-skill-loader"
import type { CommandInfo } from "./types"

export function skillToCommandInfo(skill: LoadedSkill): CommandInfo {
  return {
    name: skill.name,
    path: skill.path,
    metadata: {
      name: skill.name,
      description: skill.definition.description || "",
      argumentHint: skill.definition.argumentHint,
      model: skill.definition.model,
      agent: skill.definition.agent,
      subtask: skill.definition.subtask,
    },
    content: skill.definition.template,
    scope: skill.scope,
    lazyContentLoader: skill.lazyContent,
  }
}
