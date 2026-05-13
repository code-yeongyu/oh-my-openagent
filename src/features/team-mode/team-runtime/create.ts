import { access, mkdir } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { log } from "../../../shared/logger"
import { QUESTION_DENIED_SESSION_PERMISSION } from "../../../shared/question-denied-session-permission"
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types"
import type { BackgroundTask } from "../../background-agent/types"
import type { BackgroundManager } from "../../background-agent/manager"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import { ensureBaseDirs, getInboxDir, getTeamSpecPath, resolveBaseDir } from "../team-registry/paths"
import { createRuntimeState, listActiveTeams, loadRuntimeState, transitionRuntimeState } from "../team-state-store/store"
import { registerTeamSession } from "../team-session-registry"
import type { RuntimeState, TeamSpec } from "../types"
import { activateTeamLayout } from "./activate-team-layout"
import { cleanupTeamRunResources } from "./cleanup-team-run-resources"
import {
  registerStuckSessionMonitor,
  startStuckSessionMonitor,
} from "./stuck-session-monitor"
import { buildTeammateCommunicationAddendum } from "../member-guidance"
import { injectMemberModelOverride, resolveMember, resolveMemberWithPolicy } from "./resolve-member"
import {
  resolveMemberSelectionMode,
  type MemberSelectionPolicy,
  type StableSeed,
} from "./member-selection-policy"
import { readConnectedProvidersCache } from "../../../shared/connected-providers-cache"
import { setSessionModel } from "../../../shared/session-model-state"
import { shouldReuseCallerLeadSession } from "../resolve-caller-team-lead"
import { sweepStaleTeamSessions } from "../team-layout-tmux/sweep-stale-team-sessions"
import { resolveSandboxedWorktreePath } from "../team-worktree/manager"
import type { MemberSelectionMode } from "../../../config/schema/team-mode"
import { registerTeamRunForSessionCleanup } from "./session-team-run-registry"

const SESSION_ID_POLL_MS = 25
const EXISTING_RUNTIME_STATUSES = new Set<RuntimeState["status"]>([
  "creating",
  "active",
  "shutdown_requested",
  "orphaned",
])

type SpawnedMemberResource = {
  taskId?: string
  worktreePath?: string
}

type CreateTeamRunOptions = {
  callerAgentTypeId?: string
  parentMessageID?: string
  /**
   * Per-call override for the team's member-selection mode. Wins over
   * spec.member_selection and config.member_selection. Undefined falls
   * through to the spec/config precedence chain.
   */
  member_selection?: MemberSelectionMode
}

export class TeamRunCreateError extends Error {
  constructor(
    message: string,
    public readonly cleanupReport: {
      cancelledTaskIds: string[]
      removedLayout: boolean
      removedWorktrees: string[]
      errors: string[]
    },
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function resolveSpecSource(spec: TeamSpec, ctx: ExecutorContext, config: TeamModeConfig): Promise<"project" | "user"> {
  const baseDir = resolveBaseDir(config)
  if (await pathExists(getTeamSpecPath(baseDir, spec.name, "project", ctx.directory))) return "project"
  if (await pathExists(getTeamSpecPath(baseDir, spec.name, "user"))) return "user"
  return "project"
}

async function findExistingRuntime(spec: TeamSpec, leadSessionId: string, config: TeamModeConfig): Promise<RuntimeState | undefined> {
  for (const candidate of await listActiveTeams(config)) {
    if (candidate.teamName !== spec.name || !EXISTING_RUNTIME_STATUSES.has(candidate.status as RuntimeState["status"])) continue
    const runtimeState = await loadRuntimeState(candidate.teamRunId, config).catch(() => undefined)
    if (runtimeState?.leadSessionId === leadSessionId) return runtimeState
  }
}

async function createMemberWorktree(
  memberWorktreePath: string,
  projectRoot: string,
  config: TeamModeConfig,
): Promise<string> {
  const absolutePath = resolveSandboxedWorktreePath(projectRoot, memberWorktreePath, {
    worktreeBaseDir: path.join(resolveBaseDir(config), "worktrees"),
  })
  await mkdir(absolutePath, { recursive: true })
  return absolutePath
}

async function waitForTaskSessionId(bgMgr: BackgroundManager, task: BackgroundTask, deadlineAt: number): Promise<string> {
  let sessionId = task.sessionId
  while (!sessionId) {
    if (Date.now() > deadlineAt) throw new Error(`timed out waiting for child session for task ${task.id}`)
    const updatedTask = bgMgr.getTask(task.id)
    if (updatedTask?.status === "error" || updatedTask?.status === "cancelled" || updatedTask?.status === "interrupt") {
      throw new Error(updatedTask.error ?? `task ${task.id} failed before session creation`)
    }
    sessionId = updatedTask?.sessionId
    if (!sessionId) await new Promise((resolve) => setTimeout(resolve, SESSION_ID_POLL_MS))
  }
  return sessionId
}

function buildMemberPrompt(
  spec: TeamSpec,
  member: TeamSpec["members"][number],
  teamRunId: string,
  config: TeamModeConfig,
  worktreePath?: string,
): string {
  const promptLines = [`Team: ${spec.name}`, `TeamRunId: ${teamRunId}`, `Member: ${member.name}`]
  if (worktreePath) promptLines.push(`Worktree: ${worktreePath}`)
  if (member.prompt) promptLines.push(member.prompt)
  promptLines.push(buildTeammateCommunicationAddendum(config))
  return promptLines.join("\n")
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
  const activeRunIds = new Set(activeTeams.map((t) => t.teamRunId))
  sweepStaleTeamSessions(activeRunIds).catch((sweepError: unknown) => {
    log("team sweep stale sessions failed", {
      event: "team-sweep-stale-failed",
      phase: "create",
      error: sweepError instanceof Error ? sweepError.message : String(sweepError),
    })
  })

  const baseDir = resolveBaseDir(config)
  await ensureBaseDirs(baseDir)
  const reusesCallerLeadSession = shouldReuseCallerLeadSession(spec, options?.callerAgentTypeId)
  let runtimeState = await createRuntimeState(spec, leadSessionId, await resolveSpecSource(spec, ctx, config), config)
  registerTeamRunForSessionCleanup(runtimeState.teamRunId)
  if (reusesCallerLeadSession && spec.leadAgentId) {
    const callerLeadSubagentType = options?.callerAgentTypeId
    registerTeamSession(leadSessionId, {
      teamRunId: runtimeState.teamRunId,
      memberName: spec.leadAgentId,
      role: "lead",
    })
    runtimeState = await transitionRuntimeState(runtimeState.teamRunId, (currentState) => ({
      ...currentState,
      members: currentState.members.map((member) => member.name === spec.leadAgentId
        ? {
            ...member,
            sessionId: leadSessionId,
            status: "running",
            ...(callerLeadSubagentType ? { subagent_type: callerLeadSubagentType } : {}),
          }
        : member),
    }), config)
  }
  await Promise.all(spec.members.map((member) => mkdir(getInboxDir(baseDir, runtimeState.teamRunId, member.name), { recursive: true })))

  const deadlineAt = Date.now() + (config.max_wall_clock_minutes * 60_000)
  const resources: SpawnedMemberResource[] = spec.members.map(() => ({}))
  let createdLayout = false

  // Resolve member-selection policy ONCE up front so every follower in
  // the parallel pool sees the same view: snapshotting connectedProviders
  // for creative mode is what eliminates the cache-flicker variance the
  // user reported (3x sisyphus-junior landing on 3 different models).
  const memberSelectionMode = resolveMemberSelectionMode({
    callArg: options?.member_selection,
    spec,
    config,
  })
  const policy: MemberSelectionPolicy = memberSelectionMode === "creative"
    ? { kind: "creative", connectedProviders: readConnectedProvidersCache() }
    : { kind: "stable" }

  // Pre-resolve the lead OUTSIDE the parallel pool so its resolved model
  // can become the stable-mode seed for every follower without an own
  // override. Lead-CLI inheritance: read the caller's actual current
  // session model (the user's --model pick / UI selection) and inject it
  // as a synthetic agent override. Without this, team-mode's resolver
  // walks the agent's default fallback chain (sisyphus prefers
  // claude-opus-4-7 -> kimi-k2.6 ...) and the lead lands on chain[0]
  // regardless of what the user actually chose — exactly the
  // "claude-sonnet-4-6 falls back to kimi-k2.6 after team_create" the
  // user reported. With this lookup, the lead resolves to the user's
  // current model and stable mode broadcasts it to followers.
  const categoryExamples = Object.keys(ctx.userCategories ?? {}).join(", ")
  const leadMember = spec.leadAgentId
    ? spec.members.find((candidate) => candidate.name === spec.leadAgentId)
    : undefined
  let leadCtx = ctx
  let callerStableModel: StableSeed["model"] | undefined
  if (memberSelectionMode === "stable" && (leadMember === undefined || leadMember.model === undefined || leadMember.model === "")) {
    try {
      const callerSessionResponse = await ctx.client.session.get({ path: { id: leadSessionId } })
      // The OpenCode SDK Session type does not declare `.model` in its
      // public surface, but every session.get response in practice
      // carries `data.model = { id, providerID }` (verified by log
      // captures: `service=session ... model={"id":"...","providerID":"..."}`
      // and by system-transform.ts:2 input shape). Cast through unknown
      // to read it without committing to the SDK declaring it.
      const callerSessionData = callerSessionResponse?.data as
        | { model?: { id?: string; providerID?: string } }
        | undefined
      const callerModel = callerSessionData?.model
      if (callerModel?.providerID && callerModel.id) {
        const callerModelString = `${callerModel.providerID}/${callerModel.id}`
        callerStableModel = { providerID: callerModel.providerID, modelID: callerModel.id }
        if (leadMember) leadCtx = injectMemberModelOverride(ctx, leadMember, callerModelString)
        setSessionModel(leadSessionId, { providerID: callerModel.providerID, modelID: callerModel.id })
        log("team lead-CLI inheritance: injecting caller model into lead pre-resolve", {
          event: "team-lead-cli-inheritance",
          teamRunId: runtimeState.teamRunId,
          leadName: leadMember?.name,
          callerModel: callerModelString,
        })
      }
    } catch (callerLookupError) {
      log("team lead-CLI inheritance: caller session lookup failed, falling back to chain default", {
        event: "team-lead-cli-inheritance-failed",
        teamRunId: runtimeState.teamRunId,
        leadName: leadMember?.name,
        error: callerLookupError instanceof Error ? callerLookupError.message : String(callerLookupError),
      })
    }
  }
  let stableSeed: StableSeed | undefined
  if (memberSelectionMode === "stable" && callerStableModel && !leadMember) {
    stableSeed = { model: callerStableModel }
  } else if (memberSelectionMode === "stable" && leadMember) {
    try {
      const leadResolved = await resolveMember(leadMember, leadCtx, categoryExamples, spec.leadAgentId)
      if (leadResolved.model) {
        stableSeed = { model: leadResolved.model }
      }
    } catch (leadResolveError) {
      log("team stable-seed lead resolution failed; followers will fall back to auto", {
        event: "team-stable-seed-failed",
        teamRunId: runtimeState.teamRunId,
        leadName: leadMember.name,
        error: leadResolveError instanceof Error ? leadResolveError.message : String(leadResolveError),
      })
    }
  }

  try {
    let nextMemberIndex = 0
    let failure: Error | undefined
    const workerCount = Math.min(config.max_parallel_members, spec.members.length)

    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (!failure) {
        if (Date.now() > deadlineAt) {
          failure = new Error("team creation exceeded max_wall_clock_minutes")
          return
        }
        const memberIndex = nextMemberIndex++
        const member = spec.members[memberIndex]
        if (!member) return
        const resource = resources[memberIndex]
        if (!resource) return

        try {
          if (member.worktreePath) resource.worktreePath = await createMemberWorktree(member.worktreePath, ctx.directory, config)
          if (reusesCallerLeadSession && member.name === spec.leadAgentId) {
            if (resource.worktreePath) {
              await transitionRuntimeState(runtimeState.teamRunId, (currentState) => ({
                ...currentState,
                members: currentState.members.map((currentMember, currentIndex) => currentIndex === memberIndex
                  ? { ...currentMember, worktreePath: resource.worktreePath }
                  : currentMember),
              }), config)
            }
            continue
          }
          const isLead = member.name === spec.leadAgentId
          // Follower index = position of this member among NON-LEAD members
          // in declaration order. Stable across runs of the same spec; lets
          // creative mode round-robin deterministically.
          const followerIndex = isLead
            ? -1
            : spec.members.slice(0, memberIndex).filter((preceding) => preceding.name !== spec.leadAgentId).length
          const resolvedMember = await resolveMemberWithPolicy({
            member,
            ctx,
            policy,
            seed: stableSeed,
            followerIndex,
            isLead,
            categoryExamples,
            parentAgent: spec.leadAgentId,
          })
          const task = await bgMgr.launch({
            description: `Create team member ${spec.name}/${member.name}`,
            prompt: buildMemberPrompt(spec, member, runtimeState.teamRunId, config, resource.worktreePath),
            agent: resolvedMember.agentToUse,
            parentSessionId: leadSessionId,
            parentMessageId: options?.parentMessageID ?? `team-create:${runtimeState.teamRunId}:${member.name}`,
            teamRunId: runtimeState.teamRunId,
            suppressTmuxSpawn: true,
            model: resolvedMember.model,
            modelIntent: resolvedMember.modelIntent,
            fallbackChain: resolvedMember.fallbackChain,
            skillContent: resolvedMember.systemContent,
            category: member.kind === "category" ? member.category : undefined,
            sessionPermission: QUESTION_DENIED_SESSION_PERMISSION,
            onSessionCreated: async (sessionId) => {
              registerTeamSession(sessionId, {
                teamRunId: runtimeState.teamRunId,
                memberName: member.name,
                role: member.name === spec.leadAgentId ? "lead" : "member",
              })
              runtimeState = await transitionRuntimeState(runtimeState.teamRunId, (currentState) => ({
                ...currentState,
                members: currentState.members.map((currentMember, currentIndex) => currentIndex === memberIndex
                  ? { ...currentMember, sessionId, status: "running" }
                  : currentMember),
              }), config)
            },
          })
          resource.taskId = task.id
          const sessionId = await waitForTaskSessionId(bgMgr, task, deadlineAt)
          registerTeamSession(sessionId, {
            teamRunId: runtimeState.teamRunId,
            memberName: member.name,
            role: member.name === spec.leadAgentId ? "lead" : "member",
          })
          const persistedModel = resolvedMember.model
            ? {
                providerID: resolvedMember.model.providerID,
                modelID: resolvedMember.model.modelID,
                ...(resolvedMember.model.variant ? { variant: resolvedMember.model.variant } : {}),
                ...(resolvedMember.model.reasoningEffort ? { reasoningEffort: resolvedMember.model.reasoningEffort } : {}),
                ...(resolvedMember.model.temperature !== undefined ? { temperature: resolvedMember.model.temperature } : {}),
                ...(resolvedMember.model.top_p !== undefined ? { top_p: resolvedMember.model.top_p } : {}),
                ...(resolvedMember.model.maxTokens !== undefined ? { maxTokens: resolvedMember.model.maxTokens } : {}),
                ...(resolvedMember.model.thinking ? { thinking: resolvedMember.model.thinking } : {}),
              }
            : undefined
          await transitionRuntimeState(runtimeState.teamRunId, (currentState) => ({
            ...currentState,
            members: currentState.members.map((currentMember, currentIndex) => currentIndex === memberIndex
              ? {
                  ...currentMember,
                  sessionId,
                  status: "running",
                  worktreePath: resource.worktreePath,
                  subagent_type: resolvedMember.agentToUse,
                  ...(member.kind === "category" ? { category: member.category } : {}),
                  ...(persistedModel ? { model: persistedModel } : {}),
                }
              : currentMember),
          }), config)
        } catch (error) {
          failure = normalizeError(error)
          return
        }
      }
    }))

    if (failure) throw failure

    const launchedRuntimeState = await loadRuntimeState(runtimeState.teamRunId, config)
    emitTeamModeNotice({
      bgMgr,
      leadSessionId,
      teamRunId: runtimeState.teamRunId,
      teamName: spec.name,
      mode: memberSelectionMode,
      members: launchedRuntimeState.members,
    })
    createdLayout = await activateTeamLayout(launchedRuntimeState, config, ctx.directory, tmuxMgr)

    const activeServerUrl = tmuxMgr?.getServerUrl()
    const activeRuntimeState = await transitionRuntimeState(
      runtimeState.teamRunId,
      (currentState) => ({
        ...currentState,
        status: "active",
        ...(activeServerUrl !== undefined ? { serverUrl: activeServerUrl } : {}),
      }),
      config,
    )

    // Start the stuck-session watchdog after the team is active. The monitor
    // lifecycle is bounded to the team run: deleteTeam stops it before the
    // runtime state directory is removed.
    registerStuckSessionMonitor(activeRuntimeState.teamRunId, startStuckSessionMonitor({
      teamRunId: activeRuntimeState.teamRunId,
      config,
      client: ctx.client,
      directory: ctx.directory,
    }))

    return activeRuntimeState
  } catch (error) {
    const cleanupReport = await cleanupTeamRunResources({
      teamRunId: runtimeState.teamRunId,
      config,
      resources,
      bgMgr,
      tmuxMgr,
      createdLayout,
    })
    throw new TeamRunCreateError(`Failed to create team run '${spec.name}'`, cleanupReport, normalizeError(error))
  }
}

/**
 * Emits a `[TEAM MODE: ...]` system-reminder into the lead's pending
 * notification queue so the lead sees, on its next turn, exactly which
 * model each team member resolved to. The lead is the natural recipient
 * because it's the only session that delegates work; followers receive
 * their model assignment via the standard prompt context.
 *
 * Failures here are non-fatal: if the lead session ID is missing or the
 * notification queue rejects, we log and move on — the team is already
 * launched and emit-failure should not roll it back.
 */
function emitTeamModeNotice(input: {
  bgMgr: BackgroundManager
  leadSessionId: string
  teamRunId: string
  teamName: string
  mode: MemberSelectionMode
  members: ReadonlyArray<{ name: string; model?: { providerID: string; modelID: string } }>
}): void {
  const { bgMgr, leadSessionId, teamRunId, teamName, mode, members } = input
  try {
    const lines: string[] = []
    if (mode === "stable") {
      const distinctModels = new Set(
        members
          .map((member) => member.model)
          .filter((model): model is { providerID: string; modelID: string } => model !== undefined)
          .map((model) => `${model.providerID}/${model.modelID}`),
      )
      if (distinctModels.size === 1) {
        const onlyModel = Array.from(distinctModels)[0]
        lines.push(`[TEAM MODE: stable, model=${onlyModel}]`)
      } else {
        lines.push(`[TEAM MODE: stable]`)
        for (const member of members) {
          const modelStr = member.model ? `${member.model.providerID}/${member.model.modelID}` : "<unresolved>"
          lines.push(`- ${member.name}: ${modelStr}`)
        }
      }
    } else {
      lines.push(`[TEAM MODE: creative]`)
      for (const member of members) {
        const modelStr = member.model ? `${member.model.providerID}/${member.model.modelID}` : "<unresolved>"
        lines.push(`- ${member.name}: ${modelStr}`)
      }
    }
    bgMgr.queuePendingNotification(leadSessionId, lines.join("\n"))
    log("team mode notice emitted", {
      event: "team-mode-notice-emitted",
      teamRunId,
      teamName,
      mode,
      memberCount: members.length,
    })
  } catch (notificationError) {
    log("team mode notice emit failed", {
      event: "team-mode-notice-failed",
      teamRunId,
      teamName,
      error: notificationError instanceof Error ? notificationError.message : String(notificationError),
    })
  }
}
