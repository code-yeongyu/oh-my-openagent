import type { PluginInput } from "@opencode-ai/plugin"
import type { CategoriesConfig } from "../../config/schema"
import type { BackgroundManager } from "../../features/background-agent"
import { resolveCategoryExecution, resolveParentContext } from "../delegate-task/executor"
import type { DelegateTaskArgs, ToolContextWithMetadata } from "../delegate-task/types"
import { clearInbox, ensureInbox, sendPlainInboxMessage } from "./inbox-store"
import { assignNextColor, getTeamMember, removeTeammate, updateTeamConfig, upsertTeammate } from "./team-config-store"
import type { TeamTeammateMember, TeamToolContext } from "./types"

function parseModel(model: string | undefined): { providerID: string; modelID: string } | undefined {
  if (!model) {
    return undefined
  }
  const separatorIndex = model.indexOf("/")
  if (separatorIndex <= 0 || separatorIndex >= model.length - 1) {
    throw new Error("invalid_model_override_format")
  }

  const providerID = model.slice(0, separatorIndex)
  const modelID = model.slice(separatorIndex + 1)
  return { providerID, modelID }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveLaunchFailureMessage(status: string | undefined, error: string | undefined): string {
  if (status === "error") {
    return error ? `teammate_launch_failed:${error}` : "teammate_launch_failed"
  }

  if (status === "cancelled") {
    return "teammate_launch_cancelled"
  }

  return "teammate_launch_timeout"
}

function buildLaunchPrompt(
  teamName: string,
  teammateName: string,
  userPrompt: string,
  categoryPromptAppend?: string,
): string {
  const sections = [
    `You are teammate "${teammateName}" in team "${teamName}".`,
    `When you need updates, call read_inbox with team_name="${teamName}" and agent_name="${teammateName}".`,
    "Initial assignment:",
    userPrompt,
  ]

  if (categoryPromptAppend) {
    sections.push("Category guidance:", categoryPromptAppend)
  }

  return sections.join("\n\n")
}

function buildDeliveryPrompt(teamName: string, teammateName: string, summary: string, content: string): string {
  return [
    `New team message for "${teammateName}" in team "${teamName}".`,
    `Summary: ${summary}`,
    "Content:",
    content,
  ].join("\n\n")
}

export interface SpawnTeammateParams {
  teamName: string
  name: string
  prompt: string
  category?: string
  subagentType: string
  model?: string
  planModeRequired: boolean
  context: TeamToolContext
  manager: BackgroundManager
  categoryContext?: {
    client: PluginInput["client"]
    userCategories?: CategoriesConfig
    sisyphusJuniorModel?: string
  }
}

interface SpawnExecution {
  agentType: string
  teammateModel: string
  launchModel?: { providerID: string; modelID: string; variant?: string }
  categoryPromptAppend?: string
}

async function getSystemDefaultModel(client: PluginInput["client"]): Promise<string | undefined> {
  try {
    const openCodeConfig = await client.config.get()
    return (openCodeConfig as { data?: { model?: string } })?.data?.model
  } catch {
    return undefined
  }
}

async function resolveSpawnExecution(params: SpawnTeammateParams): Promise<SpawnExecution> {
  if (!params.category) {
    const launchModel = parseModel(params.model)
    return {
      agentType: params.subagentType,
      teammateModel: params.model ?? "native",
      ...(launchModel ? { launchModel } : {}),
    }
  }

  if (!params.categoryContext?.client) {
    throw new Error("category_requires_client_context")
  }

  const parentContext = resolveParentContext({
    sessionID: params.context.sessionID,
    messageID: params.context.messageID,
    agent: params.context.agent ?? "sisyphus",
    abort: new AbortController().signal,
  } as ToolContextWithMetadata)

  const inheritedModel = parentContext.model
    ? `${parentContext.model.providerID}/${parentContext.model.modelID}`
    : undefined

  const systemDefaultModel = await getSystemDefaultModel(params.categoryContext.client)

  const delegateArgs: DelegateTaskArgs = {
    description: `[team:${params.teamName}] ${params.name}`,
    prompt: params.prompt,
    category: params.category,
    subagent_type: "sisyphus-junior",
    run_in_background: true,
    load_skills: [],
  }

  const resolution = await resolveCategoryExecution(
    delegateArgs,
    {
      manager: params.manager,
      client: params.categoryContext.client,
      directory: process.cwd(),
      userCategories: params.categoryContext.userCategories,
      sisyphusJuniorModel: params.categoryContext.sisyphusJuniorModel,
    },
    inheritedModel,
    systemDefaultModel,
  )

  if (resolution.error) {
    throw new Error(resolution.error)
  }

  if (!resolution.categoryModel) {
    throw new Error("category_model_not_resolved")
  }

  return {
    agentType: resolution.agentToUse,
    teammateModel: `${resolution.categoryModel.providerID}/${resolution.categoryModel.modelID}`,
    launchModel: resolution.categoryModel,
    categoryPromptAppend: resolution.categoryPromptAppend,
  }
}

export async function spawnTeammate(params: SpawnTeammateParams): Promise<TeamTeammateMember> {
  const execution = await resolveSpawnExecution(params)

  let teammate: TeamTeammateMember | undefined
  let launchedTaskID: string | undefined

  updateTeamConfig(params.teamName, (current) => {
    if (getTeamMember(current, params.name)) {
      throw new Error("teammate_already_exists")
    }

    teammate = {
      agentId: `${params.name}@${params.teamName}`,
      name: params.name,
      agentType: execution.agentType,
      ...(params.category ? { category: params.category } : {}),
      model: execution.teammateModel,
      prompt: params.prompt,
      color: assignNextColor(current),
      planModeRequired: params.planModeRequired,
      joinedAt: Date.now(),
      cwd: process.cwd(),
      subscriptions: [],
      backendType: "native",
      isActive: false,
    }

    return upsertTeammate(current, teammate)
  })

  if (!teammate) {
    throw new Error("teammate_create_failed")
  }

  try {
    ensureInbox(params.teamName, params.name)
    sendPlainInboxMessage(params.teamName, "team-lead", params.name, params.prompt, "initial_prompt", teammate.color)

    const launched = await params.manager.launch({
      description: `[team:${params.teamName}] ${params.name}`,
      prompt: buildLaunchPrompt(params.teamName, params.name, params.prompt, execution.categoryPromptAppend),
      agent: execution.agentType,
      parentSessionID: params.context.sessionID,
      parentMessageID: params.context.messageID,
      ...(execution.launchModel ? { model: execution.launchModel } : {}),
      ...(params.category ? { category: params.category } : {}),
      parentAgent: params.context.agent,
    })
    launchedTaskID = launched.id

    const start = Date.now()
    let sessionID = launched.sessionID
    let latestStatus: string | undefined
    let latestError: string | undefined
    while (!sessionID && Date.now() - start < 30_000) {
      await delay(50)
      const task = params.manager.getTask(launched.id)
      latestStatus = task?.status
      latestError = task?.error
      if (task?.status === "error" || task?.status === "cancelled") {
        throw new Error(resolveLaunchFailureMessage(task.status, task.error))
      }
      sessionID = task?.sessionID
    }

    if (!sessionID) {
      throw new Error(resolveLaunchFailureMessage(latestStatus, latestError))
    }

    const nextMember: TeamTeammateMember = {
      ...teammate,
      isActive: true,
      backgroundTaskID: launched.id,
      sessionID,
    }

    updateTeamConfig(params.teamName, (current) => upsertTeammate(current, nextMember))
    return nextMember
  } catch (error) {
    if (launchedTaskID) {
      await params.manager
        .cancelTask(launchedTaskID, {
          source: "team_launch_failed",
          abortSession: true,
          skipNotification: true,
        })
        .catch(() => undefined)
    }
    updateTeamConfig(params.teamName, (current) => removeTeammate(current, params.name))
    clearInbox(params.teamName, params.name)
    throw error
  }
}

export async function resumeTeammateWithMessage(
  manager: BackgroundManager,
  context: TeamToolContext,
  teamName: string,
  teammate: TeamTeammateMember,
  summary: string,
  content: string,
): Promise<void> {
  if (!teammate.sessionID) {
    return
  }

  try {
    await manager.resume({
      sessionId: teammate.sessionID,
      prompt: buildDeliveryPrompt(teamName, teammate.name, summary, content),
      parentSessionID: context.sessionID,
      parentMessageID: context.messageID,
      parentAgent: context.agent,
    })
  } catch {
    return
  }
}

export async function cancelTeammateRun(manager: BackgroundManager, teammate: TeamTeammateMember): Promise<void> {
  if (!teammate.backgroundTaskID) {
    return
  }

  await manager.cancelTask(teammate.backgroundTaskID, {
    source: "team_force_kill",
    abortSession: true,
    skipNotification: true,
  })
}
