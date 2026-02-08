import { existsSync, readdirSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import {
  acquireLock,
  ensureDir,
  generateTaskId,
  readJsonSafe,
  writeJsonAtomic,
} from "../../features/claude-tasks/storage"
import { getTeamTaskDir, getTeamTaskPath } from "./paths"
import { TeamTask, TeamTaskSchema } from "./types"
import { validateTaskId, validateTeamName } from "./name-validation"

function assertValidTeamName(teamName: string): void {
  const validationError = validateTeamName(teamName)
  if (validationError) {
    throw new Error(validationError)
  }
}

function assertValidTaskId(taskId: string): void {
  const validationError = validateTaskId(taskId)
  if (validationError) {
    throw new Error(validationError)
  }
}

function withTaskLock<T>(teamName: string, operation: () => T): T {
  assertValidTeamName(teamName)
  const taskDir = getTeamTaskDir(teamName)
  ensureDir(taskDir)
  const lock = acquireLock(taskDir)
  if (!lock.acquired) {
    throw new Error("team_task_lock_unavailable")
  }

  try {
    return operation()
  } finally {
    lock.release()
  }
}

export function readTeamTask(teamName: string, taskId: string): TeamTask | null {
  assertValidTeamName(teamName)
  assertValidTaskId(taskId)
  return readJsonSafe(getTeamTaskPath(teamName, taskId), TeamTaskSchema)
}

export function readTeamTaskOrThrow(teamName: string, taskId: string): TeamTask {
  const task = readTeamTask(teamName, taskId)
  if (!task) {
    throw new Error("team_task_not_found")
  }
  return task
}

export function listTeamTasks(teamName: string): TeamTask[] {
  assertValidTeamName(teamName)
  const taskDir = getTeamTaskDir(teamName)
  if (!existsSync(taskDir)) {
    return []
  }

  const files = readdirSync(taskDir)
    .filter((file) => file.endsWith(".json") && file.startsWith("T-"))
    .sort((a, b) => a.localeCompare(b))

  const tasks: TeamTask[] = []
  for (const file of files) {
    const taskId = file.replace(/\.json$/, "")
    if (validateTaskId(taskId)) {
      continue
    }
    const task = readTeamTask(teamName, taskId)
    if (task) {
      tasks.push(task)
    }
  }

  return tasks
}

export function createTeamTask(
  teamName: string,
  subject: string,
  description: string,
  activeForm?: string,
  metadata?: Record<string, unknown>,
): TeamTask {
  assertValidTeamName(teamName)
  if (!subject.trim()) {
    throw new Error("team_task_subject_required")
  }

  return withTaskLock(teamName, () => {
    const task: TeamTask = {
      id: generateTaskId(),
      subject,
      description,
      activeForm,
      status: "pending",
      blocks: [],
      blockedBy: [],
      ...(metadata ? { metadata } : {}),
    }

    const validated = TeamTaskSchema.parse(task)
    writeJsonAtomic(getTeamTaskPath(teamName, validated.id), validated)
    return validated
  })
}

export function writeTeamTask(teamName: string, task: TeamTask): TeamTask {
  assertValidTeamName(teamName)
  assertValidTaskId(task.id)
  const validated = TeamTaskSchema.parse(task)
  writeJsonAtomic(getTeamTaskPath(teamName, validated.id), validated)
  return validated
}

export function deleteTeamTaskFile(teamName: string, taskId: string): void {
  assertValidTeamName(teamName)
  assertValidTaskId(taskId)
  const taskPath = getTeamTaskPath(teamName, taskId)
  if (existsSync(taskPath)) {
    unlinkSync(taskPath)
  }
}

export function readTaskFromDirectory(taskDir: string, taskId: string): TeamTask | null {
  assertValidTaskId(taskId)
  return readJsonSafe(join(taskDir, `${taskId}.json`), TeamTaskSchema)
}

export function resetOwnerTasks(teamName: string, ownerName: string): void {
  assertValidTeamName(teamName)
  withTaskLock(teamName, () => {
    const tasks = listTeamTasks(teamName)
    for (const task of tasks) {
      if (task.owner !== ownerName) {
        continue
      }
      const next: TeamTask = {
        ...task,
        owner: undefined,
        status: task.status === "completed" ? "completed" : "pending",
      }
      writeTeamTask(teamName, next)
    }
  })
}

export function withTeamTaskLock<T>(teamName: string, operation: () => T): T {
  assertValidTeamName(teamName)
  return withTaskLock(teamName, operation)
}
