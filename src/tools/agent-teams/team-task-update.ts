import { existsSync, readdirSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { readJsonSafe, writeJsonAtomic } from "../../features/claude-tasks/storage"
import { validateTaskId, validateTeamName } from "./name-validation"
import { getTeamTaskDir, getTeamTaskPath } from "./paths"
import {
  addPendingEdge,
  createPendingEdgeMap,
  ensureDependenciesCompleted,
  ensureForwardStatusTransition,
  wouldCreateCycle,
} from "./team-task-dependency"
import {
  applyAddedBlockedBy,
  applyAddedBlocks,
  removeCompletedTaskFromDependents,
  removeDeletedTaskReferences,
} from "./dependency-writer"
import { TeamTask, TeamTaskSchema, TeamTaskStatus } from "./types"
import { withTeamTaskLock } from "./team-task-store"

export interface TeamTaskUpdatePatch {
  status?: TeamTaskStatus
  owner?: string
  subject?: string
  description?: string
  activeForm?: string
  addBlocks?: string[]
  addBlockedBy?: string[]
  metadata?: Record<string, unknown>
}

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

function writeTaskToPath(path: string, task: TeamTask): void {
  writeJsonAtomic(path, TeamTaskSchema.parse(task))
}

function assertPatchTaskReferences(patch: TeamTaskUpdatePatch): void {
  for (const blockedTaskId of patch.addBlocks ?? []) {
    assertValidTaskId(blockedTaskId)
  }

  for (const blockerId of patch.addBlockedBy ?? []) {
    assertValidTaskId(blockerId)
  }
}

export function updateTeamTask(teamName: string, taskId: string, patch: TeamTaskUpdatePatch): TeamTask {
  assertValidTeamName(teamName)
  assertValidTaskId(taskId)
  assertPatchTaskReferences(patch)

  return withTeamTaskLock(teamName, () => {
    const taskDir = getTeamTaskDir(teamName)
    const taskPath = getTeamTaskPath(teamName, taskId)
    const currentTask = readJsonSafe(taskPath, TeamTaskSchema)
    if (!currentTask) {
      throw new Error("team_task_not_found")
    }

    const cache = new Map<string, TeamTask | null>()
    cache.set(taskId, currentTask)

    const readTask = (id: string): TeamTask | null => {
      if (cache.has(id)) {
        return cache.get(id) ?? null
      }
      const loaded = readJsonSafe(join(taskDir, `${id}.json`), TeamTaskSchema)
      cache.set(id, loaded)
      return loaded
    }

    const pendingEdges = createPendingEdgeMap()

    if (patch.addBlocks) {
      for (const blockedTaskId of patch.addBlocks) {
        if (blockedTaskId === taskId) {
          throw new Error("team_task_self_block")
        }
        if (!readTask(blockedTaskId)) {
          throw new Error(`team_task_reference_not_found:${blockedTaskId}`)
        }
        addPendingEdge(pendingEdges, blockedTaskId, taskId)
      }

      for (const blockedTaskId of patch.addBlocks) {
        if (wouldCreateCycle(blockedTaskId, taskId, pendingEdges, readTask)) {
          throw new Error(`team_task_cycle_detected:${taskId}->${blockedTaskId}`)
        }
      }
    }

    if (patch.addBlockedBy) {
      for (const blockerId of patch.addBlockedBy) {
        if (blockerId === taskId) {
          throw new Error("team_task_self_dependency")
        }
        if (!readTask(blockerId)) {
          throw new Error(`team_task_reference_not_found:${blockerId}`)
        }
        addPendingEdge(pendingEdges, taskId, blockerId)
      }

      for (const blockerId of patch.addBlockedBy) {
        if (wouldCreateCycle(taskId, blockerId, pendingEdges, readTask)) {
          throw new Error(`team_task_cycle_detected:${taskId}<-${blockerId}`)
        }
      }
    }

    if (patch.status && patch.status !== "deleted") {
      ensureForwardStatusTransition(currentTask.status, patch.status)
    }

    const effectiveStatus = patch.status ?? currentTask.status
    const effectiveBlockedBy = Array.from(new Set([...(currentTask.blockedBy ?? []), ...(patch.addBlockedBy ?? [])]))
    const shouldValidateDependencies =
      (patch.status !== undefined || (patch.addBlockedBy?.length ?? 0) > 0) && effectiveStatus !== "deleted"

    if (shouldValidateDependencies) {
      ensureDependenciesCompleted(effectiveStatus, effectiveBlockedBy, readTask)
    }

    let nextTask: TeamTask = { ...currentTask }

    if (patch.subject !== undefined) {
      nextTask.subject = patch.subject
    }
    if (patch.description !== undefined) {
      nextTask.description = patch.description
    }
    if (patch.activeForm !== undefined) {
      nextTask.activeForm = patch.activeForm
    }
    if (patch.owner !== undefined) {
      nextTask.owner = patch.owner === "" ? undefined : patch.owner
    }

    const pendingWrites = new Map<string, TeamTask>()

    if (patch.addBlocks) {
      applyAddedBlocks({ teamName, taskId, task: nextTask, pendingWrites, readTask }, patch.addBlocks)
    }

    if (patch.addBlockedBy) {
      applyAddedBlockedBy({ teamName, taskId, task: nextTask, pendingWrites, readTask }, patch.addBlockedBy)
    }

    if (patch.metadata !== undefined) {
      const merged: Record<string, unknown> = { ...(nextTask.metadata ?? {}) }
      for (const [key, value] of Object.entries(patch.metadata)) {
        if (value === null) {
          delete merged[key]
        } else {
          merged[key] = value
        }
      }
      nextTask.metadata = Object.keys(merged).length > 0 ? merged : undefined
    }

    if (patch.status !== undefined) {
      nextTask.status = patch.status
    }

    const allTaskIds = readdirSync(taskDir)
      .filter((file) => file.endsWith(".json") && file.startsWith("T-"))
      .map((file) => file.replace(/\.json$/, ""))

    if (nextTask.status === "completed") {
      removeCompletedTaskFromDependents(teamName, taskId, allTaskIds, pendingWrites, readTask)
    }

    if (patch.status === "deleted") {
      removeDeletedTaskReferences(teamName, taskId, allTaskIds, pendingWrites, readTask)
    }

    for (const [path, task] of pendingWrites.entries()) {
      writeTaskToPath(path, task)
    }

    if (patch.status === "deleted") {
      if (existsSync(taskPath)) {
        unlinkSync(taskPath)
      }
      return TeamTaskSchema.parse({ ...nextTask, status: "deleted" })
    }

    writeTaskToPath(taskPath, nextTask)
    return TeamTaskSchema.parse(nextTask)
  })
}
