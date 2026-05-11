import type { BackgroundManager } from "../../background-agent/manager"
import type { TeamModeConfig } from "../../../config/schema/team-mode"
import type { RuntimeState, Task } from "../types"
import { detectStaleLock } from "../team-state-store/locks"
import { loadRuntimeState } from "../team-state-store/store"
import { listUnreadMessages } from "../team-mailbox/inbox"
import { listTasks } from "../team-tasklist/list"
import { getTasksDir, resolveBaseDir } from "../team-registry/paths"
import { readdir } from "node:fs/promises"
import path from "node:path"

export interface TeamStatus {
  teamName: string
  teamRunId: string
  status: RuntimeState["status"]
  leadSessionId?: string
  createdAt: number
  members: Array<{
    name: string
    sessionId?: string
    status: RuntimeState["members"][number]["status"]
    color?: string
    worktreePath?: string
    unreadMessages: number
    paneId?: string
  }>
  tasks: {
    pending: number
    claimed: number
    in_progress: number
    completed: number
    deleted: number
    total: number
  }
  shutdownRequests: RuntimeState["shutdownRequests"]
  concurrency: {
    runningOnSameModel: number
    queuedOnSameModel: number
    teamRunIdSpecific?: number
  }
  bounds: RuntimeState["bounds"]
  staleLocks: string[]
}

type ConcurrencyCounts = {
  running: number
  queued: number
}

type TeamBackgroundManager = BackgroundManager & {
  getConcurrencyCounts?: (modelOrUndefined?: string) => ConcurrencyCounts
  listTasksByParentSession?: (sessionID: string) => Array<unknown>
}

function getPrimaryModelKey(bgMgr: TeamBackgroundManager | undefined, leadSessionId: string | undefined): string | undefined {
  if (!bgMgr || !leadSessionId) return undefined

  const tasksByParent = bgMgr.getTasksByParentSession(leadSessionId)
  if (tasksByParent.length === 0) return undefined

  const firstModel = tasksByParent[0]?.model
  if (!firstModel) return undefined

  return `${firstModel.providerID}/${firstModel.modelID}`
}

function countTasks(tasks: Task[]): TeamStatus["tasks"] {
  const counts = {
    pending: 0,
    claimed: 0,
    in_progress: 0,
    completed: 0,
    deleted: 0,
    total: 0,
  }

  for (const task of tasks) {
    counts[task.status] += 1
    counts.total += 1
  }

  return counts
}

function resolveConcurrencyCounts(bgMgr: TeamBackgroundManager | undefined, leadSessionId: string | undefined): ConcurrencyCounts {
  if (!bgMgr || !leadSessionId) return { running: 0, queued: 0 }

  const modelKey = getPrimaryModelKey(bgMgr, leadSessionId)
  const tasksByParent = bgMgr.getTasksByParentSession(leadSessionId)
  const counts = bgMgr.getConcurrencyCounts?.(modelKey)

  if (counts) {
    return { running: counts.running, queued: counts.queued }
  }

  const running = tasksByParent.filter((task) => task.status === "running").length
  const queued = tasksByParent.filter((task) => task.status === "pending").length

  return { running, queued }
}

export async function aggregateStatus(
  teamRunId: string,
  config: TeamModeConfig,
  bgMgr?: BackgroundManager,
): Promise<TeamStatus> {
  const runtimeState = await loadRuntimeState(teamRunId, config)
  const unreadCounts = await Promise.all(
    runtimeState.members.map(async (member) => ({
      member,
      unreadMessages: (await listUnreadMessages(teamRunId, member.name, config)).length,
    })),
  )
  const tasks = await listTasks(teamRunId, config)
  const teamBackgroundManager: TeamBackgroundManager | undefined = bgMgr
  const concurrencyCounts = resolveConcurrencyCounts(teamBackgroundManager, runtimeState.leadSessionId)
  const teamRunIdSpecific = teamBackgroundManager?.listTasksByParentSession?.(runtimeState.leadSessionId ?? teamRunId)?.length
  const baseDir = resolveBaseDir(config)
  const claimsDir = path.join(getTasksDir(baseDir, teamRunId), "claims")
  const staleLockEntries = await readdir(claimsDir, { withFileTypes: true }).catch(() => [])
  const staleLockPaths = await Promise.all(
    staleLockEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".lock"))
      .map(async (entry) => {
        const lockPath = path.join(claimsDir, entry.name)
        return (await detectStaleLock(lockPath, 300_000)) ? lockPath : undefined
      }),
  )

  return {
    teamName: runtimeState.teamName,
    teamRunId: runtimeState.teamRunId,
    status: runtimeState.status,
    leadSessionId: runtimeState.leadSessionId,
    createdAt: runtimeState.createdAt,
    members: unreadCounts.map(({ member, unreadMessages }) => ({
      name: member.name,
      sessionId: member.sessionId,
      status: member.status,
      color: member.color,
      worktreePath: member.worktreePath,
      unreadMessages,
      paneId: member.tmuxPaneId,
    })),
    tasks: countTasks(tasks),
    shutdownRequests: runtimeState.shutdownRequests,
    concurrency: {
      runningOnSameModel: concurrencyCounts.running,
      queuedOnSameModel: concurrencyCounts.queued,
      teamRunIdSpecific,
    },
    bounds: runtimeState.bounds,
    staleLocks: staleLockPaths.filter((lockPath): lockPath is string => lockPath !== undefined),
  }
}
