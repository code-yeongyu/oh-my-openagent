import { canonicalProjectDir } from "./mirror-path"
import { assertNever } from "./state-types"
import { listActiveTeams, loadRuntimeState } from "@oh-my-opencode/team-core/team-state-store/store"
import { listTasks } from "@oh-my-opencode/team-core/team-tasklist/list"
import type { TeamModeConfig } from "@oh-my-opencode/team-core/config"
import type { TeamMemberRow, TeamRow } from "./state-types"
import type { ActiveTeamSummary, RuntimeState, RuntimeStateMember, Task } from "@oh-my-opencode/team-core/types"

export type TeamProjectSession = {
  readonly id: string
  readonly directory: string
}

export type TeamRuntimeProvider = {
  readonly listActiveTeams: () => Promise<readonly ActiveTeamSummary[]>
  readonly loadRuntimeState: (teamRunId: string) => Promise<RuntimeState>
  readonly listTasks: (teamRunId: string) => Promise<readonly Task[]>
}

export type BuildTeamsProjectionInput = {
  readonly projectDir: string
  readonly sessions: readonly TeamProjectSession[]
  readonly runtimeProvider: TeamRuntimeProvider
}

export function createTeamRuntimeProvider(config: TeamModeConfig): TeamRuntimeProvider {
  return {
    listActiveTeams: () => listActiveTeams(config),
    loadRuntimeState: (teamRunId) => loadRuntimeState(teamRunId, config),
    listTasks: (teamRunId) => listTasks(teamRunId, config),
  }
}

export async function buildTeamsProjection(input: BuildTeamsProjectionInput): Promise<readonly TeamRow[]> {
  const sessionsById = new Map(input.sessions.map((session) => [session.id, session]))
  const projectSessionIds = new Set(
    input.sessions
      .filter((session) => canonicalProjectDir(session.directory) === canonicalProjectDir(input.projectDir))
      .map((session) => session.id),
  )
  const activeTeams = await input.runtimeProvider.listActiveTeams()
  const runtimes = await Promise.all(activeTeams.map((team) => input.runtimeProvider.loadRuntimeState(team.teamRunId)))
  const teams: Array<TeamRow | null> = await Promise.all(
    runtimes.map(async (runtime) => {
      if (!isRelevantToProject(runtime, projectSessionIds)) {
        return null
      }

      const tasks = await input.runtimeProvider.listTasks(runtime.teamRunId)
      return {
        name: runtime.teamName,
        members: runtime.members.map((member) => toTeamMemberRow(member, tasks, sessionsById)),
      }
    }),
  )

  return teams
    .filter((team): team is TeamRow => team !== null)
    .toSorted((left, right) => left.name.localeCompare(right.name))
}

export function selectCurrentWork(memberName: string, tasks: readonly Task[]): string | null {
  const task = tasks
    .filter((candidate) => candidate.owner === memberName && isCurrentTask(candidate))
    .toSorted(compareCurrentTasks)[0]

  return task?.activeForm ?? task?.subject ?? null
}

function isRelevantToProject(runtime: RuntimeState, projectSessionIds: ReadonlySet<string>): boolean {
  if (runtime.leadSessionId !== undefined && projectSessionIds.has(runtime.leadSessionId)) {
    return true
  }

  return runtime.members.some((member) => member.sessionId !== undefined && projectSessionIds.has(member.sessionId))
}

function toTeamMemberRow(
  member: RuntimeStateMember,
  tasks: readonly Task[],
  sessionsById: ReadonlyMap<string, TeamProjectSession>,
): TeamMemberRow {
  return {
    name: member.name,
    status: member.status,
    work: selectCurrentWork(member.name, tasks),
    sessionId: member.sessionId !== undefined && sessionsById.has(member.sessionId) ? member.sessionId : null,
  }
}

function isCurrentTask(task: Task): boolean {
  switch (task.status) {
    case "in_progress":
    case "claimed":
    case "pending":
      return true
    case "completed":
    case "deleted":
      return false
    default:
      return assertNever(task.status)
  }
}

function compareCurrentTasks(left: Task, right: Task): number {
  const statusOrder = currentTaskStatusOrder(left.status) - currentTaskStatusOrder(right.status)
  if (statusOrder !== 0) {
    return statusOrder
  }

  const updatedAtOrder = right.updatedAt - left.updatedAt
  if (updatedAtOrder !== 0) {
    return updatedAtOrder
  }

  return left.id.localeCompare(right.id)
}

function currentTaskStatusOrder(status: Task["status"]): number {
  switch (status) {
    case "in_progress":
      return 0
    case "claimed":
      return 1
    case "pending":
      return 2
    case "completed":
    case "deleted":
      return Number.POSITIVE_INFINITY
    default:
      return assertNever(status)
  }
}
