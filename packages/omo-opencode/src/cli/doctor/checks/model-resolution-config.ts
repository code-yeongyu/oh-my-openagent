import { validatePluginConfig } from "../../../config/validate"
import type { OmoConfig } from "./model-resolution-types"

function modelConfig(config: ReturnType<typeof validatePluginConfig>["config"]): OmoConfig {
  const agents = Object.fromEntries(Object.entries(config.agents ?? {}).flatMap(([name, agent]) => {
    if (!agent || typeof agent !== "object") return []
    const entry = {
      ...(agent.model === undefined ? {} : { model: agent.model }),
      ...(agent.variant === undefined ? {} : { variant: agent.variant }),
      ...(agent.category === undefined ? {} : { category: agent.category }),
    }
    return Object.keys(entry).length === 0 ? [] : [[name, entry]]
  }))
  const categories = Object.fromEntries(Object.entries(config.categories ?? {}).flatMap(([name, category]) => {
    if (!category || typeof category !== "object") return []
    const entry = {
      ...(category.model === undefined ? {} : { model: category.model }),
      ...(category.variant === undefined ? {} : { variant: category.variant }),
    }
    return Object.keys(entry).length === 0 ? [] : [[name, entry]]
  }))
  return { agents, categories }
}

export function loadOmoConfig(): OmoConfig {
  return modelConfig(validatePluginConfig(process.cwd()).config)
}
