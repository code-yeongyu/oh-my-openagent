import type { OmoConfig, OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import { listActiveTeams, loadRuntimeState } from "@oh-my-opencode/team-core/team-state-store"
import { log } from "@oh-my-opencode/utils"
import {
  TEAM_LEAD_SENTINEL,
  claimTeamTask,
  createTeam,
  createTeamTask,
  createTaskRecordStore,
  deleteTeam,
  getTeamTask,
  listTeamTasks,
  reconcileTeamMailboxOnSessionStart,
  parseExtensionEntries,
  resolveMemberExtensionEntryPath,
  refreshTeamMemberStatuses,
  requestShutdown,
  approveShutdown,
  rejectShutdown,
  resolveTeamRuntimeDirs,
  sendTeamMessage,
  teamStorageBaseDir,
  toTeamCoreConfig,
  updateTeamTaskStatus,
  type ActiveTeamSummary,
  type PersistedTaskEvent,
  type StateDirConfig,
  type TaskManager,
  type TeamCoreConfig,
  type TeamToolsService,
} from "@oh-my-opencode/senpi-task"

import type { TaskRuntimeContext } from "./runtime-context"
import {
  buildMemberPorts,
  makeCancelMemberTask,
  makeShutdownMessenger,
  resolveTeamSpec,
} from "./team-service-support"

// The team members spawn one level below the current (lead) session, matching the task tool's
// (ancestry.depth + 1) child spawn depth for a top-level lead.
const TEAM_MEMBER_SPAWN_DEPTH = 1

export interface TeamServiceDeps {
  readonly manager: TaskManager
  readonly runtime: TaskRuntimeContext
  readonly settings: OmoTaskSettings
  readonly omoConfig: OmoConfig
  readonly cwd: string
  readonly agentNames: ReadonlySet<string>
  readonly appendTaskEvent?: (taskId: string, event: PersistedTaskEvent) => void
  readonly now?: () => number
  readonly newMessageId?: () => string
}

function stateDirConfig(deps: TeamServiceDeps): StateDirConfig {
  return {
    project_dir: deps.cwd,
    ...(deps.settings.state_dir !== undefined ? { task: { state_dir: deps.settings.state_dir } } : {}),
  }
}

function createTaskEventAppender(stateDir: StateDirConfig): (taskId: string, event: PersistedTaskEvent) => void {
  const store = createTaskRecordStore(stateDir)
  return (taskId, event) => {
    try {
      store.appendEvent(taskId, event)
    } catch (error) {
      log("omo-senpi task event append failed", {
        taskId,
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

// The lead is ALWAYS the current session; there is no model-supplied override (dropped per W3-V F2 so
// the "current session IS lead" sentinel cannot be spoofed by a tool argument).
function requireLeadSession(deps: TeamServiceDeps): string {
  const leadSessionId = deps.runtime.sessionId()
  if (leadSessionId === undefined || leadSessionId.length === 0) {
    throw new Error("team tools require an active lead session; none was captured yet")
  }
  return leadSessionId
}

function toTeams(rows: Awaited<ReturnType<typeof listActiveTeams>>): readonly ActiveTeamSummary[] {
  return rows.map((row) => ({
    teamRunId: row.teamRunId,
    teamName: row.teamName,
    status: row.status,
    memberCount: row.memberCount,
    scope: row.scope,
    ...(row.leadSessionId !== undefined ? { leadSessionId: row.leadSessionId } : {}),
  }))
}

export function createTeamService(deps: TeamServiceDeps): TeamToolsService {
  const stateDir = stateDirConfig(deps)
  const config: TeamCoreConfig = toTeamCoreConfig(deps.settings, teamStorageBaseDir(stateDir))
  const appendTaskEvent = deps.appendTaskEvent ?? createTaskEventAppender(stateDir)
  const ports = buildMemberPorts(deps.omoConfig, deps.agentNames)
  const omoTeams = deps.omoConfig.teams as Record<string, unknown> | undefined
  const runtimeDir = (teamRunId: string) => resolveTeamRuntimeDirs(stateDir, teamRunId).runtimeDir
  const memberExtensionEntryPath = resolveMemberExtensionEntryPath()

  const service: TeamToolsService = {
    async createTeam(input) {
      const leadSessionId = requireLeadSession(deps)
      const { spec, source } = await resolveTeamSpec(input, ports, deps.cwd, omoTeams)
      return createTeam(spec, source, {
        manager: deps.manager,
        stateDir,
        taskSettings: deps.settings,
        leadSessionId,
        spawnDepth: TEAM_MEMBER_SPAWN_DEPTH,
        ...(deps.now !== undefined ? { now: deps.now } : {}),
        memberExtension: {
          entryPath: memberExtensionEntryPath,
          inheritedExtensions: [memberExtensionEntryPath, ...parseExtensionEntries(process.argv)],
        },
      })
    },
    deleteTeam: (input) => deleteTeam(input.teamRunId, { manager: deps.manager, stateDir, taskSettings: deps.settings }),
    sendMessage: async (teamRunId, input) => {
      const runtimeState = await loadRuntimeState(teamRunId, config)
      return sendTeamMessage(input, {
        teamRunId,
        stateDir,
        config,
        activeMembers: runtimeState.members.map((member) => member.name),
        appendEvent: appendTaskEvent,
        ...(deps.now !== undefined ? { now: deps.now } : {}),
        ...(deps.newMessageId !== undefined ? { newMessageId: deps.newMessageId } : {}),
      })
    },
    status: (teamRunId) => refreshTeamMemberStatuses(teamRunId, { manager: deps.manager, config, runtimeDir: runtimeDir(teamRunId) }),
    listTeams: async () => toTeams(await listActiveTeams(config)),
    createTask: (teamRunId, input) =>
      createTeamTask({ teamRunId, config }, {
        subject: input.subject,
        description: input.description,
        status: input.status,
        ...(input.owner !== undefined ? { owner: input.owner } : {}),
        ...(input.blockedBy !== undefined ? { blockedBy: input.blockedBy } : {}),
      }),
    listTasks: (teamRunId, filter) => listTeamTasks({ teamRunId, config }, filter),
    updateTask: (input) => {
      const ctx = { teamRunId: input.teamRunId, config }
      const owner = input.owner ?? TEAM_LEAD_SENTINEL
      return input.status === "claimed"
        ? claimTeamTask(ctx, input.taskId, owner)
        : updateTeamTaskStatus(ctx, input.taskId, input.status, owner)
    },
    getTask: (teamRunId, taskId) => getTeamTask({ teamRunId, config }, taskId),
    requestShutdown: (teamRunId, member) =>
      requestShutdown(teamRunId, member, {
        config,
        sendMessage: makeShutdownMessenger(deps.manager, stateDir, teamRunId),
        ...(deps.now !== undefined ? { now: deps.now } : {}),
      }),
    approveShutdown: (teamRunId, member) =>
      approveShutdown(teamRunId, member, {
        config,
        sendMessage: makeShutdownMessenger(deps.manager, stateDir, teamRunId),
        cancelMemberTask: makeCancelMemberTask(deps.manager, stateDir, teamRunId),
        ...(deps.now !== undefined ? { now: deps.now } : {}),
      }),
    rejectShutdown: (teamRunId, member, reason) =>
      rejectShutdown(teamRunId, member, reason, {
        config,
        sendMessage: makeShutdownMessenger(deps.manager, stateDir, teamRunId),
        ...(deps.now !== undefined ? { now: deps.now } : {}),
      }),
  }
  return service
}

/**
 * The component `session_start` mailbox reconciler bound to the same state dir + team-core config as the
 * live service: on process start it restores any delivery reservation left dangling by a crash back to
 * unread (across every active team run) so the on-revive injection fallback can redeliver it (W3-V F1a).
 */
export function createTeamMailboxReconciler(deps: TeamServiceDeps): () => Promise<void> {
  const stateDir = stateDirConfig(deps)
  const config: TeamCoreConfig = toTeamCoreConfig(deps.settings, teamStorageBaseDir(stateDir))
  return () => reconcileTeamMailboxOnSessionStart({
    stateDir,
    config,
    currentLeadSessionId: deps.runtime.sessionId(),
  })
}
