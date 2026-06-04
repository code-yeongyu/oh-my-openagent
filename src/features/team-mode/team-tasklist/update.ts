import path from "node:path"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { getTasksDir, resolveBaseDir } from "../team-registry"
import { atomicWrite } from "../team-state-store/locks"
import { TaskSchema } from "../types"
import type { Task } from "../types"
import { claimTask } from "./claim"
import { getTask } from "./get"

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

export async function updateTaskStatus(
  teamRunId: string,
  taskId: string,
  newStatus: Task["status"],
  memberName: string,
  config: TeamModeConfig,
): Promise<Task> {
  const task = await getTask(teamRunId, taskId, config)

  if (task.status === newStatus) return task

  if (task.status === "pending" && newStatus === "in_progress") {
    await claimTask(teamRunId, taskId, memberName, config)
    return updateTaskStatus(teamRunId, taskId, newStatus, memberName, config)
  }

  if (!isValidTransition(task.status, newStatus)) {
    throw new InvalidTaskTransitionError(task.status, newStatus)
  }

  if (newStatus !== "deleted" && task.owner !== memberName) {
    throw new CrossOwnerUpdateError()
  }

  const updatedTask = TaskSchema.parse({
    ...task,
    status: newStatus,
    updatedAt: Date.now(),
  })

  const tasksDirectory = getTasksDir(resolveBaseDir(config), teamRunId)
  await atomicWrite(
    path.join(tasksDirectory, `${taskId}.json`),
    `${JSON.stringify(updatedTask, null, 2)}\n`,
  )

  return updatedTask
}
