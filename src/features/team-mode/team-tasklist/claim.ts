import { access, mkdir } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { getTasksDir, resolveBaseDir } from "../team-registry"
import { atomicWrite, detectStaleLock, reapStaleLock, withLock } from "../team-state-store/locks"
import { TaskSchema } from "../types"
import type { Task } from "../types"
import { canClaim } from "./dependencies"
import { getTask } from "./get"
import { listTasks } from "./list"

const CLAIM_STALE_AFTER_MS = 300_000

async function lockExists(lockPath: string): Promise<boolean> {
  try {
    await access(lockPath)
    return true
  } catch {
    return false
  }
}

function getBlockingTaskIds(task: Task, allTasks: Task[]): string[] {
  return task.blockedBy.filter((blockerId) => {
    const blockerTask = allTasks.find((candidateTask) => candidateTask.id === blockerId)
    return blockerTask !== undefined && blockerTask.status !== "completed"
  })
}

export class AlreadyClaimedError extends Error {
  constructor(message = "already_claimed") {
    super(message)
    this.name = "AlreadyClaimedError"
  }
}

export class BlockedByError extends Error {
  constructor(public readonly blockers: string[]) {
    super(`blocked by ${blockers.join(",")}`)
    this.name = "BlockedByError"
  }
}

export async function claimTask(
  teamRunId: string,
  taskId: string,
  memberName: string,
  config: TeamModeConfig,
): Promise<Task> {
  const baseDirectory = resolveBaseDir(config)
  const tasksDirectory = getTasksDir(baseDirectory, teamRunId)
  const claimsDirectory = path.join(tasksDirectory, "claims")
  const taskPath = path.join(tasksDirectory, `${taskId}.json`)
  const claimLockPath = path.join(claimsDirectory, `${taskId}.lock`)

  await mkdir(claimsDirectory, { recursive: true, mode: 0o700 })

  const task = await getTask(teamRunId, taskId, config)
  if (task.status !== "pending") {
    throw new AlreadyClaimedError()
  }

  const allTasks = await listTasks(teamRunId, config)
  if (!canClaim(task, allTasks)) {
    throw new BlockedByError(getBlockingTaskIds(task, allTasks))
  }

  if (await detectStaleLock(claimLockPath, CLAIM_STALE_AFTER_MS)) {
    await reapStaleLock(claimLockPath)
  } else if (await lockExists(claimLockPath)) {
    throw new AlreadyClaimedError()
  }

  return withLock(claimLockPath, async () => {
    const refreshedTask = await getTask(teamRunId, taskId, config)
    if (refreshedTask.status !== "pending") {
      throw new AlreadyClaimedError()
    }

    const refreshedTasks = await listTasks(teamRunId, config)
    if (!canClaim(refreshedTask, refreshedTasks)) {
      throw new BlockedByError(getBlockingTaskIds(refreshedTask, refreshedTasks))
    }

    const now = Date.now()
    const updatedTask = TaskSchema.parse({
      ...refreshedTask,
      status: "claimed",
      owner: memberName,
      claimedAt: now,
      updatedAt: now,
    })

    await atomicWrite(taskPath, `${JSON.stringify(updatedTask, null, 2)}\n`)
    return updatedTask
  }, { ownerTag: memberName, staleAfterMs: CLAIM_STALE_AFTER_MS })
}
