import type { BackgroundManager } from "../../features/background-agent"
import { ensureInbox, sendPlainInboxMessage } from "./inbox-store"
import { assignNextColor, getTeamMember, readTeamConfigOrThrow, removeTeammate, upsertTeammate, writeTeamConfig } from "./team-config-store"
import type { TeamTeammateMember, TeamToolContext } from "./types"

function parseModel(model: string | undefined): { providerID: string; modelID: string } | undefined {
  if (!model) {
    return undefined
  }
  const [providerID, modelID] = model.split("/", 2)
  if (!providerID || !modelID) {
    return undefined
  }
  return { providerID, modelID }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildLaunchPrompt(teamName: string, teammateName: string, userPrompt: string): string {
  return [
    `You are teammate "${teammateName}" in team "${teamName}".`,
    `When you need updates, call read_inbox with team_name="${teamName}" and agent_name="${teammateName}".`,
    "Initial assignment:",
    userPrompt,
  ].join("\n\n")
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
  subagentType: string
  model?: string
  planModeRequired: boolean
  context: TeamToolContext
  manager: BackgroundManager
}

export async function spawnTeammate(params: SpawnTeammateParams): Promise<TeamTeammateMember> {
  const config = readTeamConfigOrThrow(params.teamName)

  if (getTeamMember(config, params.name)) {
    throw new Error("teammate_already_exists")
  }

  const teammate: TeamTeammateMember = {
    agentId: `${params.name}@${params.teamName}`,
    name: params.name,
    agentType: params.subagentType,
    model: params.model ?? "native",
    prompt: params.prompt,
    color: assignNextColor(config),
    planModeRequired: params.planModeRequired,
    joinedAt: Date.now(),
    cwd: process.cwd(),
    subscriptions: [],
    backendType: "native",
    isActive: false,
  }

  writeTeamConfig(params.teamName, upsertTeammate(config, teammate))
  ensureInbox(params.teamName, params.name)
  sendPlainInboxMessage(params.teamName, "team-lead", params.name, params.prompt, "initial_prompt", teammate.color)

  try {
    const resolvedModel = parseModel(params.model)
    const launched = await params.manager.launch({
      description: `[team:${params.teamName}] ${params.name}`,
      prompt: buildLaunchPrompt(params.teamName, params.name, params.prompt),
      agent: params.subagentType,
      parentSessionID: params.context.sessionID,
      parentMessageID: params.context.messageID,
      ...(resolvedModel ? { model: resolvedModel } : {}),
      parentAgent: params.context.agent,
    })

    const start = Date.now()
    let sessionID = launched.sessionID
    while (!sessionID && Date.now() - start < 30_000) {
      await delay(50)
      const task = params.manager.getTask(launched.id)
      sessionID = task?.sessionID
    }

    const nextMember: TeamTeammateMember = {
      ...teammate,
      isActive: true,
      backgroundTaskID: launched.id,
      ...(sessionID ? { sessionID } : {}),
    }

    const current = readTeamConfigOrThrow(params.teamName)
    writeTeamConfig(params.teamName, upsertTeammate(current, nextMember))
    return nextMember
  } catch (error) {
    const rollback = readTeamConfigOrThrow(params.teamName)
    writeTeamConfig(params.teamName, removeTeammate(rollback, params.name))
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
