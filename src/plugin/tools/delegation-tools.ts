import type { ToolDefinition } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../../config"
import type { Managers } from "../../create-managers"
import type { AvailableCategory } from "../../agents/dynamic-agent-prompt-builder"
import type { PluginContext } from "../types"
import type { SkillContext } from "../skill-context"
import {
  createCallOmoAgent,
  createLookAt,
  createDelegateTask,
  createA2aDelegateTool,
  DEFAULT_OPENFANG_BASE_URL,
} from "../../tools"

export function createDelegationAndAgentTools(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  managers: Pick<Managers, "backgroundManager" | "tmuxSessionManager">
  skillContext: SkillContext
  availableCategories: AvailableCategory[]
}): Record<string, ToolDefinition> {
  const { ctx, pluginConfig, managers, skillContext, availableCategories } = args

  const callOmoAgent = createCallOmoAgent(
    ctx,
    managers.backgroundManager,
    pluginConfig.disabled_agents ?? [],
    pluginConfig.agents,
    pluginConfig.categories,
  )

  const isMultimodalLookerEnabled = !(pluginConfig.disabled_agents ?? []).some(
    (agent) => agent.toLowerCase() === "multimodal-looker",
  )
  const lookAt = isMultimodalLookerEnabled ? createLookAt(ctx) : null

  const delegateTask = createDelegateTask({
    manager: managers.backgroundManager,
    client: ctx.client,
    directory: ctx.directory,
    userCategories: pluginConfig.categories,
    agentOverrides: pluginConfig.agents,
    gitMasterConfig: pluginConfig.git_master,
    browserProvider: skillContext.browserProvider,
    disabledSkills: skillContext.disabledSkills,
    availableCategories,
    availableSkills: skillContext.availableSkills,
    sisyphusAgentConfig: pluginConfig.sisyphus_agent,
    syncPollTimeoutMs: pluginConfig.background_task?.syncPollTimeoutMs,
    onSyncSessionCreated: async (event) => {
      await managers.tmuxSessionManager.onSessionCreated({
        type: "session.created",
        properties: {
          info: {
            id: event.sessionID,
            parentID: event.parentID,
            title: event.title,
          },
        },
      })
    },
  })

  const a2aDelegateTools = createA2aDelegateTool(
    ctx,
    pluginConfig.openfang?.base_url ?? DEFAULT_OPENFANG_BASE_URL,
  )

  return {
    call_omo_agent: callOmoAgent,
    ...(lookAt ? { look_at: lookAt } : {}),
    task: delegateTask,
    ...a2aDelegateTools,
  }
}
