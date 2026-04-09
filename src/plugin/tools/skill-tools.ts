import type { ToolDefinition } from "@opencode-ai/plugin"
import type { SkillLoadOptions } from "../../tools/skill/types"
import type { OhMyOpenCodeConfig } from "../../config"
import type { Managers } from "../../create-managers"
import type { PluginContext } from "../types"
import type { SkillContext } from "../skill-context"
import { createSkillMcpTool, createSkillTool, discoverCommandsSync } from "../../tools"
import { getMainSessionID } from "../../features/claude-code-session-state"

export function createSkillAndMcpTools(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  managers: Pick<Managers, "skillMcpManager">
  skillContext: SkillContext
}): Record<string, ToolDefinition> {
  const { ctx, pluginConfig, managers, skillContext } = args

  const getSessionID = (): string | undefined => getMainSessionID()

  const skillMcpTool = createSkillMcpTool({
    manager: managers.skillMcpManager,
    getLoadedSkills: () => skillContext.mergedSkills,
    getSessionID,
  })

  const commands = discoverCommandsSync(ctx.directory, {
    pluginsEnabled: pluginConfig.claude_code?.plugins ?? true,
    enabledPluginsOverride: pluginConfig.claude_code?.plugins_override,
  })

  const skillTool = createSkillTool({
    commands,
    skills: skillContext.mergedSkills,
    mcpManager: managers.skillMcpManager,
    getSessionID,
    gitMasterConfig: pluginConfig.git_master,
    browserProvider: skillContext.browserProvider,
    nativeSkills: "skills" in ctx
      ? (ctx as { skills: SkillLoadOptions["nativeSkills"] }).skills
      : undefined,
  })

  return {
    skill_mcp: skillMcpTool,
    skill: skillTool,
  }
}
