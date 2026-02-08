import type { AvailableCategory, AvailableSkill } from "./agents/dynamic-agent-prompt-builder"
import type { OhMyOpenCodeConfig } from "./config"
import type { BrowserAutomationProvider } from "./config/schema/browser-automation"
import type { LoadedSkill } from "./features/opencode-skill-loader/types"
import type { PluginContext, ToolsRecord } from "./plugin/types"
import type { Managers } from "./create-managers"

import { createAvailableCategories } from "./plugin/available-categories"
import { createSkillContext } from "./plugin/skill-context"
import { createToolRegistry } from "./plugin/tool-registry"

export type CreateToolsResult = {
  filteredTools: ToolsRecord
  mergedSkills: LoadedSkill[]
  availableSkills: AvailableSkill[]
  availableCategories: AvailableCategory[]
  browserProvider: BrowserAutomationProvider
  disabledSkills: Set<string>
  taskSystemEnabled: boolean
}

export async function createTools(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  managers: Pick<Managers, "backgroundManager" | "tmuxSessionManager" | "skillMcpManager">
}): Promise<CreateToolsResult> {
  const { ctx, pluginConfig, managers } = args

  const skillContext = await createSkillContext({
    directory: ctx.directory,
    pluginConfig,
  })

  const availableCategories = createAvailableCategories(pluginConfig)

  const { filteredTools, taskSystemEnabled } = createToolRegistry({
    ctx,
    pluginConfig,
    managers,
    skillContext,
    availableCategories,
  })

  return {
    filteredTools,
    mergedSkills: skillContext.mergedSkills,
    availableSkills: skillContext.availableSkills,
    availableCategories,
    browserProvider: skillContext.browserProvider,
    disabledSkills: skillContext.disabledSkills,
    taskSystemEnabled,
  }
}
