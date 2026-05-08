import { mkdir } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { getTasksDir, resolveBaseDir } from "../team-registry"
import { atomicWrite, withLock } from "../team-state-store/locks"
import { TaskSchema } from "../types"
import type { Task } from "../types"
import { BlockedByError } from "./claim"
import { canClaim } from "./dependencies"
import { getTask } from "./get"
import { listTasks } from "./list"

const ALLOWED_TRANSITIONS: Readonly<Record<Task["status"], ReadonlyArray<Task["status"]>>> = {
  pending: ["claimed", "deleted"],
  claimed: ["in_progress", "deleted"],
  in_progress: ["completed", "deleted"],
  completed: ["deleted"],
  deleted: [],
}

function isValidTransition(currentStatus: Task["status"], nextStatus: Task["status"]): boolean {
  if (currentStatus === nextStatus) return true
  return ALLOWED_TRANSITIONS[currentStatus].includes(nextStatus)
}

export class InvalidTaskTransitionError extends Error {
  constructor(currentStatus: Task["status"], nextStatus: Task["status"]) {
    super(`no reverse transitions from ${currentStatus} to ${nextStatus}`)
    this.name = "InvalidTaskTransitionError"
  }
}

export class CrossOwnerUpdateError extends Error {
  constructor(message = "cross-owner updates are not allowed") {
    super(message)
    this.name = "CrossOwnerUpdateError"
  }
}

type TaskActorInput = string | {
  memberName: string
  isLead?: boolean
}

type TaskActor = {
  memberName: string
  isLead: boolean
}

function normalizeTaskActor(actor: TaskActorInput): TaskActor {
  if (typeof actor === "string") {
    return { memberName: actor, isLead: false }
  }

  return {
    memberName: actor.memberName,
    isLead: actor.isLead === true,
  }
}

function getBlockingTaskIds(task: Task, allTasks: Task[]): string[] {
  return task.blockedBy.filter((blockerId) => {
    const blockerTask = allTasks.find((candidateTask) => candidateTask.id === blockerId)
    return blockerTask !== undefined && blockerTask.status !== "completed"
  })
}

function assertDeletePermission(task: Task, actor: TaskActor): void {
  if (actor.isLead || task.owner === actor.memberName) {
    return
  }

  throw new CrossOwnerUpdateError("task deletion requires the task owner or team lead")
}

export async function updateTaskStatus(
  teamRunId: string,
  taskId: string,
  newStatus: Task["status"],
  actorInput: TaskActorInput,
  config: TeamModeConfig,
): Promise<Task> {
  const actor = normalizeTaskActor(actorInput)
  const tasksDirectory = getTasksDir(resolveBaseDir(config), teamRunId)
  const claimsDirectory = path.join(tasksDirectory, "claims")
  const taskPath = path.join(tasksDirectory, `${taskId}.json`)
  const taskLockPath = path.join(claimsDirectory, `${taskId}.lock`)

  await mkdir(claimsDirectory, { recursive: true, mode: 0o700 })

  return await withLock(taskLockPath, async () => {
    const task = await getTask(teamRunId, taskId, config)
    if (task.status === newStatus) return task

    const now = Date.now()
    let updatedTask: Task

    if (task.status === "pending" && (newStatus === "claimed" || newStatus === "in_progress")) {
      const allTasks = await listTasks(teamRunId, config)
      if (!canClaim(task, allTasks)) {
        throw new BlockedByError(getBlockingTaskIds(task, allTasks))
      }

      updatedTask = TaskSchema.parse({
        ...task,
        status: newStatus,
        owner: actor.memberName,
        claimedAt: now,
        updatedAt: now,
      })
    } else {
      if (!isValidTransition(task.status, newStatus)) {
        throw new InvalidTaskTransitionError(task.status, newStatus)
      }

      if (newStatus === "deleted") {
        assertDeletePermission(task, actor)
      } else if (task.owner !== actor.memberName) {
        throw new CrossOwnerUpdateError()
      }

      updatedTask = TaskSchema.parse({
        ...task,
        status: newStatus,
        updatedAt: now,
      })
    }

    await atomicWrite(taskPath, `${JSON.stringify(updatedTask, null, 2)}\n`)
    return updatedTask
  }, { ownerTag: `update-task:${actor.memberName}` })
}
