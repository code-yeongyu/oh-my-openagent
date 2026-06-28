import type { TeamModeConfig } from "../config"
import { getTaskFilePath, resolveBaseDir } from "../team-registry"
import { atomicWrite } from "../team-state-store/locks"
import { TaskSchema } from "../types"
import type { Task } from "../types"
import { claimTask } from "./claim"
import { getTask } from "./get"

type TaskStatusUpdateOptions = {
  readonly metadata?: Record<string, unknown>
}

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
  options?: TaskStatusUpdateOptions,
): Promise<Task> {
  const task = await getTask(teamRunId, taskId, config)

  if (task.status === newStatus && options?.metadata === undefined) return task

  if (task.status === "pending" && newStatus === "in_progress") {
    await claimTask(teamRunId, taskId, memberName, config)
    return updateTaskStatus(teamRunId, taskId, newStatus, memberName, config, options)
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
    metadata: options?.metadata === undefined ? task.metadata : { ...task.metadata, ...options.metadata },
    updatedAt: Date.now(),
  })

  await atomicWrite(
    getTaskFilePath(resolveBaseDir(config), teamRunId, taskId),
    `${JSON.stringify(updatedTask, null, 2)}\n`,
  )

  return updatedTask
}
