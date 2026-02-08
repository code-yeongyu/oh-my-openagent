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

export function updateTeamTask(teamName: string, taskId: string, patch: TeamTaskUpdatePatch): TeamTask {
  assertValidTeamName(teamName)
  assertValidTaskId(taskId)

  if (patch.addBlocks) {
    for (const blockedTaskId of patch.addBlocks) {
      assertValidTaskId(blockedTaskId)
    }
  }

  if (patch.addBlockedBy) {
    for (const blockerId of patch.addBlockedBy) {
      assertValidTaskId(blockerId)
    }
  }

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
      const effectiveBlockedBy = Array.from(new Set([...(currentTask.blockedBy ?? []), ...(patch.addBlockedBy ?? [])]))
      ensureDependenciesCompleted(patch.status, effectiveBlockedBy, readTask)
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
      nextTask.owner = patch.owner
    }

    const pendingWrites = new Map<string, TeamTask>()

    if (patch.addBlocks) {
      const existingBlocks = new Set(nextTask.blocks)
      for (const blockedTaskId of patch.addBlocks) {
        if (!existingBlocks.has(blockedTaskId)) {
          nextTask.blocks.push(blockedTaskId)
          existingBlocks.add(blockedTaskId)
        }

        const otherPath = getTeamTaskPath(teamName, blockedTaskId)
        const other = pendingWrites.get(otherPath) ?? readTask(blockedTaskId)
        if (other && !other.blockedBy.includes(taskId)) {
          pendingWrites.set(otherPath, { ...other, blockedBy: [...other.blockedBy, taskId] })
        }
      }
    }

    if (patch.addBlockedBy) {
      const existingBlockedBy = new Set(nextTask.blockedBy)
      for (const blockerId of patch.addBlockedBy) {
        if (!existingBlockedBy.has(blockerId)) {
          nextTask.blockedBy.push(blockerId)
          existingBlockedBy.add(blockerId)
        }

        const otherPath = getTeamTaskPath(teamName, blockerId)
        const other = pendingWrites.get(otherPath) ?? readTask(blockerId)
        if (other && !other.blocks.includes(taskId)) {
          pendingWrites.set(otherPath, { ...other, blocks: [...other.blocks, taskId] })
        }
      }
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

    const allTaskFiles = readdirSync(taskDir).filter((file) => file.endsWith(".json") && file.startsWith("T-"))

    if (nextTask.status === "completed") {
      for (const file of allTaskFiles) {
        const otherId = file.replace(/\.json$/, "")
        if (otherId === taskId) continue

        const otherPath = getTeamTaskPath(teamName, otherId)
        const other = pendingWrites.get(otherPath) ?? readTask(otherId)
        if (other?.blockedBy.includes(taskId)) {
          pendingWrites.set(otherPath, {
            ...other,
            blockedBy: other.blockedBy.filter((id) => id !== taskId),
          })
        }
      }
    }

    if (patch.status === "deleted") {
      for (const file of allTaskFiles) {
        const otherId = file.replace(/\.json$/, "")
        if (otherId === taskId) continue

        const otherPath = getTeamTaskPath(teamName, otherId)
        const other = pendingWrites.get(otherPath) ?? readTask(otherId)
        if (!other) continue

        const nextOther = {
          ...other,
          blockedBy: other.blockedBy.filter((id) => id !== taskId),
          blocks: other.blocks.filter((id) => id !== taskId),
        }
        pendingWrites.set(otherPath, nextOther)
      }
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
