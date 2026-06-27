import type { ToolDefinition } from "@opencode-ai/plugin"
import type { SkillLoadOptions } from "../tools/skill/types"
import type { AvailableCategory } from "../agents/dynamic-agent-prompt-builder"
import type { OhMyOpenCodeConfig } from "../config"
import type { Managers } from "../create-managers"
import type { SkillContext } from "./skill-context"
import type { PluginContext, ToolsRecord } from "./types"
import type { ToolRegistryFactories } from "./tool-registry-factories"

import { getMainSessionID } from "../features/claude-code-session-state"
import * as openclawRuntimeDispatch from "../openclaw/runtime-dispatch"
import { log } from "../shared"
import { getSisyphusJuniorModelOverride } from "./tool-registry-team-tools"
import { createSkillContext } from "./skill-context"
import { createRuntimeSkillsResolver, readRuntimeHostSkills } from "./runtime-skill-resolver"

type NativeSkillAccessor = NonNullable<SkillLoadOptions["nativeSkills"]>
type NativeSkillList = Awaited<ReturnType<NativeSkillAccessor["all"]>>
type NativeSkillResponse = NativeSkillList | { data?: NativeSkillList | null }

type RawSkillClient = {
  _client?: {
    get?: (input: { url: string; query: { directory: string } }) => Promise<NativeSkillResponse>
  }
}

function createNativeSkillAccessor(ctx: PluginContext, disabledSkills?: Set<string>): NativeSkillAccessor | undefined {
  if ("skills" in ctx) {
    return (ctx as { skills?: NativeSkillAccessor }).skills
  }

  const rawClient = (ctx.client as unknown as RawSkillClient | undefined)?._client
  const rawGet = rawClient?.get
  if (typeof rawGet !== "function") return undefined

  const dir = ctx.directory
  let listPromise: Promise<NativeSkillList> | undefined

  const all = async (): Promise<NativeSkillList> => {
    const response = await rawGet.call(rawClient, { url: "/skill", query: { directory: dir } })
    let list: NativeSkillList = []
    if (Array.isArray(response)) {
      list = response
    } else if (response && typeof response === "object" && Array.isArray((response as { data: unknown }).data)) {
      list = (response as { data: NativeSkillList }).data
    }
    if (!disabledSkills || disabledSkills.size === 0) return list
    return list.filter((skill) => !disabledSkills.has(skill.name))
  }

  return {
    all() {
      listPromise ??= all()
      return listPromise
    },
    async get(name) {
      return (await this.all()).find((skill) => skill.name === name)
    },
    dirs() {
      return []
    },
  }
}

export function createCoreTools(args: {
  readonly ctx: PluginContext
  readonly pluginConfig: OhMyOpenCodeConfig
  readonly managers: Pick<Managers, "backgroundManager" | "tmuxSessionManager" | "skillMcpManager" | "modelFallbackControllerAccessor">
  readonly skillContext: SkillContext
  readonly availableCategories: AvailableCategory[]
  readonly factories: ToolRegistryFactories
}): Record<string, ToolDefinition> {
  const { ctx, pluginConfig, managers, skillContext, availableCategories, factories } = args
  const nativeSkills = createNativeSkillAccessor(ctx, skillContext.disabledSkills)
  const backgroundTools = factories.createBackgroundTools(managers.backgroundManager, ctx.client)
  const callOmoAgent = factories.createCallOmoAgent(
    ctx,
    managers.backgroundManager,
    pluginConfig.disabled_agents ?? [],
    pluginConfig.agents,
    pluginConfig.categories,
    managers.modelFallbackControllerAccessor,
  )
  const isMultimodalLookerEnabled = !(pluginConfig.disabled_agents ?? []).some(
    (agent) => agent.toLowerCase() === "multimodal-looker",
  )
  const delegateTask = factories.createDelegateTask({
    manager: managers.backgroundManager,
    client: ctx.client,
    directory: ctx.directory,
    userCategories: pluginConfig.categories,
    agentOverrides: pluginConfig.agents,
    gitMasterConfig: pluginConfig.git_master,
    sisyphusJuniorModel: getSisyphusJuniorModelOverride(pluginConfig.agents?.["sisyphus-junior"]),
    browserProvider: skillContext.browserProvider,
    disabledSkills: skillContext.disabledSkills,
    teamModeEnabled: pluginConfig.team_mode?.enabled ?? false,
    availableCategories,
    availableSkills: skillContext.availableSkills,
    nativeSkills,
    sisyphusAgentConfig: pluginConfig.sisyphus_agent,
    syncPollTimeoutMs: pluginConfig.background_task?.syncPollTimeoutMs,
    modelFallbackControllerAccessor: managers.modelFallbackControllerAccessor,
    onSyncSessionCreated: async (event) => {
      log("[index] onSyncSessionCreated callback", {
        sessionID: event.sessionID,
        parentID: event.parentID,
        title: event.title,
      })
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

      if (pluginConfig.openclaw) {
        await openclawRuntimeDispatch.dispatchOpenClawEvent({
          config: pluginConfig.openclaw,
          rawEvent: "session.created",
          context: {
            sessionId: event.sessionID,
            projectPath: ctx.directory,
            tmuxPaneId: managers.tmuxSessionManager.getTrackedPaneId?.(event.sessionID) ?? process.env.TMUX_PANE,
          },
        })
      }
    },
  })

  const getSessionIDForMcp = (): string | undefined => getMainSessionID()
  const getLoadedSkillsForMcp = createRuntimeSkillsResolver({
    baseSkills: skillContext.mergedSkills,
    readRuntimeHostSkills: () => readRuntimeHostSkills(ctx.client),
    buildMergedSkills: async (hostSkills) =>
      (await createSkillContext({ directory: ctx.directory, pluginConfig, hostSkills })).mergedSkills,
  })
  const skillMcpTool = factories.createSkillMcpTool({
    manager: managers.skillMcpManager,
    getLoadedSkills: getLoadedSkillsForMcp,
    getSessionID: getSessionIDForMcp,
  })
  const commands = factories.discoverCommandsSync(ctx.directory, {
    pluginsEnabled: pluginConfig.claude_code?.plugins ?? true,
    enabledPluginsOverride: pluginConfig.claude_code?.plugins_override,
  })
  const skillTool = factories.createSkillTool({
    directory: ctx.directory,
    commands,
    skills: skillContext.mergedSkills,
    mcpManager: managers.skillMcpManager,
    getSessionID: getSessionIDForMcp,
    gitMasterConfig: pluginConfig.git_master,
    browserProvider: skillContext.browserProvider,
    disabledSkills: skillContext.disabledSkills,
    teamModeEnabled: pluginConfig.team_mode?.enabled ?? false,
    nativeSkills,
    pluginsEnabled: pluginConfig.claude_code?.plugins ?? true,
    enabledPluginsOverride: pluginConfig.claude_code?.plugins_override,
    includeSkillsInDescription: true,
  })

  const tools: ToolsRecord = {
    ...factories.createGrepTools(ctx),
    ...factories.createGlobTools(ctx),
    ...factories.createSessionManagerTools(ctx),
    ...backgroundTools,
    call_omo_agent: callOmoAgent,
  }
  if (isMultimodalLookerEnabled) {
    tools.look_at = factories.createLookAt(ctx)
  }
  tools.task = delegateTask
  tools.skill_mcp = skillMcpTool
  tools.skill = skillTool

  return tools
}
