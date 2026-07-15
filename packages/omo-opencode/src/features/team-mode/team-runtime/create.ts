import { mkdir } from "node:fs/promises"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { QUESTION_DENIED_SESSION_PERMISSION } from "../../../shared/question-denied-session-permission"
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types"
import type { BackgroundManager } from "../../background-agent/manager"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import { getInboxDir, ensureBaseDirs, resolveBaseDir } from "../team-registry/paths"
import { createRuntimeState, listActiveTeams, loadRuntimeState, transitionRuntimeState } from "../team-state-store/store"
import { registerTeamSession } from "../team-session-registry"
import type { RuntimeState, TeamSpec } from "../types"
import { shouldReuseCallerLeadSession } from "../resolve-caller-team-lead"
import { sweepStaleTeamSessions } from "../team-layout-tmux/sweep-stale-team-sessions"
import { activateTeamLayout } from "./activate-team-layout"
import { cleanupTeamRunResources } from "./cleanup-team-run-resources"
import {
  buildMemberPrompt,
  findExistingRuntime,
  resolveSpecSource,
  updateMemberInRuntimeState,
  waitForTaskSessionId,
} from "./create-helpers"
import { prepareTeamMembers, TeamMemberPreflightError } from "./prepare-team-members"
import { registerTeamRunForSessionCleanup } from "./session-team-run-registry"
import type { TeamRunCleanupReport } from "./team-run-create-types"
import { assertNoUnresolvedTeamMembers } from "./unresolved-team-members"

type CreateTeamRunOptions = {
  callerAgentTypeId?: string
  parentMessageID?: string
}

export class TeamRunCreateError extends Error {
  constructor(
    message: string,
    public readonly cleanupReport: TeamRunCleanupReport,
    cause: Error,
  ) {
    super(`${message}: ${cause.message}`)
    this.name = "TeamRunCreateError"
    this.cause = cause
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function getPreflightCause(error: TeamMemberPreflightError): Error {
  return error.cause instanceof Error ? error.cause : error
}

export async function createTeamRun(
  spec: TeamSpec,
  leadSessionId: string,
  ctx: ExecutorContext,
  config: TeamModeConfig,
  bgMgr: BackgroundManager,
  tmuxMgr?: TmuxSessionManager,
  options?: CreateTeamRunOptions,
): Promise<RuntimeState> {
  const existingRuntime = await findExistingRuntime(spec, leadSessionId, config)
  if (existingRuntime) return existingRuntime

  const activeTeams = await listActiveTeams(config)
  sweepStaleTeamSessions(new Set(activeTeams.map((team) => team.teamRunId))).catch(() => {})

  const baseDir = resolveBaseDir(config)
  await ensureBaseDirs(baseDir)
  const reusesCallerLeadSession = shouldReuseCallerLeadSession(spec, options?.callerAgentTypeId)
  const deadlineAt = Date.now() + (config.max_wall_clock_minutes * 60_000)
  const createErrorMessage = `Failed to create team run '${spec.name}'`

  let preparedMembers: Awaited<ReturnType<typeof prepareTeamMembers>>
  try {
    preparedMembers = await prepareTeamMembers({ spec, ctx, reusesCallerLeadSession })
  } catch (error) {
    if (error instanceof TeamMemberPreflightError) {
      throw new TeamRunCreateError(createErrorMessage, error.cleanupReport, getPreflightCause(error))
    }
    throw error
  }

  let runtimeState = await createRuntimeState(
    spec,
    leadSessionId,
    await resolveSpecSource(spec, ctx.directory, config),
    config,
  )
  registerTeamRunForSessionCleanup(runtimeState.teamRunId)
  if (reusesCallerLeadSession && spec.leadAgentId) {
    const callerLeadSubagentType = options?.callerAgentTypeId
    registerTeamSession(leadSessionId, {
      teamRunId: runtimeState.teamRunId,
      memberName: spec.leadAgentId,
      role: "lead",
    })
    runtimeState = await updateMemberInRuntimeState({
      teamRunId: runtimeState.teamRunId,
      memberName: spec.leadAgentId,
      patch: (member) => ({
        ...member,
        sessionId: leadSessionId,
        status: "running",
        ...(callerLeadSubagentType ? { subagent_type: callerLeadSubagentType } : {}),
      }),
      config,
    })
  }
  await Promise.all(spec.members.map((member) =>
    mkdir(getInboxDir(baseDir, runtimeState.teamRunId, member.name), { recursive: true }),
  ))

  const resources = preparedMembers.map((preparedMember) => preparedMember.resource)
  let createdLayout = false

  try {
    let nextMemberIndex = 0
    let failure: Error | undefined
    const workerCount = Math.min(config.max_parallel_members, preparedMembers.length)

    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (!failure) {
        if (Date.now() > deadlineAt) {
          failure = new Error("team creation exceeded max_wall_clock_minutes")
          return
        }
        const preparedMember = preparedMembers[nextMemberIndex++]
        if (!preparedMember) return
        const { member, resource } = preparedMember

        try {
          if (preparedMember.kind === "reused-lead") {
            if (resource.worktreePath) {
              runtimeState = await updateMemberInRuntimeState({
                teamRunId: runtimeState.teamRunId,
                memberName: member.name,
                patch: (currentMember) => ({ ...currentMember, worktreePath: resource.worktreePath }),
                config,
              })
            }
            continue
          }

          const task = await bgMgr.launch({
            description: `Create team member ${spec.name}/${member.name}`,
            prompt: buildMemberPrompt({
              spec,
              member,
              teamRunId: runtimeState.teamRunId,
              config,
              worktreePath: resource.worktreePath,
            }),
            agent: preparedMember.resolvedMember.agentToUse,
            directory: preparedMember.directory,
            exactAgent: preparedMember.resolvedMember.exactAgent,
            parentSessionId: leadSessionId,
            parentMessageId: options?.parentMessageID ?? `team-create:${runtimeState.teamRunId}:${member.name}`,
            teamRunId: runtimeState.teamRunId,
            suppressTmuxSpawn: true,
            model: preparedMember.resolvedMember.model,
            fallbackChain: preparedMember.resolvedMember.fallbackChain,
            skillContent: preparedMember.resolvedMember.systemContent,
            category: member.kind === "category" ? member.category : undefined,
            sessionPermission: QUESTION_DENIED_SESSION_PERMISSION,
            onSessionCreated: async (sessionId) => {
              registerTeamSession(sessionId, {
                teamRunId: runtimeState.teamRunId,
                memberName: member.name,
                role: member.name === spec.leadAgentId ? "lead" : "member",
              })
              runtimeState = await updateMemberInRuntimeState({
                teamRunId: runtimeState.teamRunId,
                memberName: member.name,
                patch: (currentMember) => ({ ...currentMember, sessionId, status: "running" }),
                config,
              })
            },
          })
          resource.taskId = task.id
          const sessionId = await waitForTaskSessionId(bgMgr, task, deadlineAt)
          registerTeamSession(sessionId, {
            teamRunId: runtimeState.teamRunId,
            memberName: member.name,
            role: member.name === spec.leadAgentId ? "lead" : "member",
          })
          const resolvedModel = preparedMember.resolvedMember.model
          const persistedModel = resolvedModel ? {
            providerID: resolvedModel.providerID,
            modelID: resolvedModel.modelID,
            ...(resolvedModel.variant ? { variant: resolvedModel.variant } : {}),
            ...(resolvedModel.reasoningEffort ? { reasoningEffort: resolvedModel.reasoningEffort } : {}),
            ...(resolvedModel.temperature !== undefined ? { temperature: resolvedModel.temperature } : {}),
            ...(resolvedModel.top_p !== undefined ? { top_p: resolvedModel.top_p } : {}),
            ...(resolvedModel.maxTokens !== undefined ? { maxTokens: resolvedModel.maxTokens } : {}),
            ...(resolvedModel.thinking ? { thinking: resolvedModel.thinking } : {}),
          } : undefined
          runtimeState = await updateMemberInRuntimeState({
            teamRunId: runtimeState.teamRunId,
            memberName: member.name,
            patch: (currentMember) => ({
              ...currentMember,
              sessionId,
              status: "running",
              worktreePath: resource.worktreePath,
              subagent_type: preparedMember.resolvedMember.agentToUse,
              ...(member.kind === "category" ? { category: member.category } : {}),
              ...(persistedModel ? { model: persistedModel } : {}),
            }),
            config,
          })
        } catch (error) {
          failure = error instanceof Error ? error : new Error(String(error))
          return
        }
      }
    }))

    if (failure) throw failure

    const launchedRuntimeState = await loadRuntimeState(runtimeState.teamRunId, config)
    assertNoUnresolvedTeamMembers(launchedRuntimeState.members)
    createdLayout = await activateTeamLayout(launchedRuntimeState, config, ctx.directory, tmuxMgr)
    return await transitionRuntimeState(runtimeState.teamRunId, (state) => ({ ...state, status: "active" }), config)
  } catch (error) {
    const cleanupReport = await cleanupTeamRunResources({
      teamRunId: runtimeState.teamRunId,
      config,
      resources,
      bgMgr,
      tmuxMgr,
      createdLayout,
    })
    throw new TeamRunCreateError(createErrorMessage, cleanupReport, normalizeError(error))
  }
}
