import type { BackgroundManager } from "../../features/background-agent"
import { clearInbox, ensureInbox, sendPlainInboxMessage } from "./inbox-store"
import { assignNextColor, getTeamMember, removeTeammate, updateTeamConfig, upsertTeammate } from "./team-config-store"
import type { TeamTeammateMember, TeamToolContext } from "./types"
import { resolveTeamParentContext } from "./teammate-parent-context"
import { buildDeliveryPrompt, buildLaunchPrompt } from "./teammate-prompts"
import { resolveSpawnExecution, type TeamCategoryContext } from "./teammate-spawn-execution"

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

export interface SpawnTeammateParams {
  teamName: string
  name: string
  prompt: string
  category: string
  subagentType: string
  model?: string
  planModeRequired: boolean
  context: TeamToolContext
  manager: BackgroundManager
  categoryContext?: TeamCategoryContext
}

export async function spawnTeammate(params: SpawnTeammateParams): Promise<TeamTeammateMember> {
  const parentContext = resolveTeamParentContext(params.context)
  const execution = await resolveSpawnExecution(
    {
      teamName: params.teamName,
      name: params.name,
      prompt: params.prompt,
      category: params.category,
      subagentType: params.subagentType,
      model: params.model,
      manager: params.manager,
      categoryContext: params.categoryContext,
    },
    parentContext,
  )

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
      category: params.category,
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
      parentSessionID: parentContext.sessionID,
      parentMessageID: parentContext.messageID,
      parentModel: parentContext.model,
      ...(execution.launchModel ? { model: execution.launchModel } : {}),
      ...(params.category ? { category: params.category } : {}),
      parentAgent: parentContext.agent,
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
    const originalError = error

    if (launchedTaskID) {
      await params.manager
        .cancelTask(launchedTaskID, {
          source: "team_launch_failed",
          abortSession: true,
          skipNotification: true,
        })
        .catch(() => undefined)
    }

    try {
      updateTeamConfig(params.teamName, (current) => removeTeammate(current, params.name))
    } catch (cleanupError) {
      void cleanupError
    }

    try {
      clearInbox(params.teamName, params.name)
    } catch (cleanupError) {
      void cleanupError
    }

    throw originalError
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

  const parentContext = resolveTeamParentContext(context)

  try {
    await manager.resume({
      sessionId: teammate.sessionID,
      prompt: buildDeliveryPrompt(teamName, teammate.name, summary, content),
      parentSessionID: parentContext.sessionID,
      parentMessageID: parentContext.messageID,
      parentModel: parentContext.model,
      parentAgent: parentContext.agent,
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
