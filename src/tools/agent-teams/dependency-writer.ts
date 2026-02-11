import { getTeamTaskPath } from "./paths"
import type { TeamTask } from "./types"

type TaskReader = (taskId: string) => TeamTask | null

interface DependencyWriteParams {
  teamName: string
  taskId: string
  task: TeamTask
  pendingWrites: Map<string, TeamTask>
  readTask: TaskReader
}

export function applyAddedBlocks(params: DependencyWriteParams, addBlocks: string[]): void {
  const { teamName, taskId, task, pendingWrites, readTask } = params
  const existingBlocks = new Set(task.blocks)

  for (const blockedTaskId of addBlocks) {
    if (!existingBlocks.has(blockedTaskId)) {
      task.blocks.push(blockedTaskId)
      existingBlocks.add(blockedTaskId)
    }

    const otherPath = getTeamTaskPath(teamName, blockedTaskId)
    const other = pendingWrites.get(otherPath) ?? readTask(blockedTaskId)
    if (other && !other.blockedBy.includes(taskId)) {
      pendingWrites.set(otherPath, { ...other, blockedBy: [...other.blockedBy, taskId] })
    }
  }
}

export function applyAddedBlockedBy(params: DependencyWriteParams, addBlockedBy: string[]): void {
  const { teamName, taskId, task, pendingWrites, readTask } = params
  const existingBlockedBy = new Set(task.blockedBy)

  for (const blockerId of addBlockedBy) {
    if (!existingBlockedBy.has(blockerId)) {
      task.blockedBy.push(blockerId)
      existingBlockedBy.add(blockerId)
    }

    const otherPath = getTeamTaskPath(teamName, blockerId)
    const other = pendingWrites.get(otherPath) ?? readTask(blockerId)
    if (other && !other.blocks.includes(taskId)) {
      pendingWrites.set(otherPath, { ...other, blocks: [...other.blocks, taskId] })
    }
  }
}

export function removeCompletedTaskFromDependents(
  teamName: string,
  taskId: string,
  allTaskIds: string[],
  pendingWrites: Map<string, TeamTask>,
  readTask: TaskReader,
): void {
  for (const otherId of allTaskIds) {
    if (otherId === taskId) {
      continue
    }

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

export function removeDeletedTaskReferences(
  teamName: string,
  taskId: string,
  allTaskIds: string[],
  pendingWrites: Map<string, TeamTask>,
  readTask: TaskReader,
): void {
  for (const otherId of allTaskIds) {
    if (otherId === taskId) {
      continue
    }

    const otherPath = getTeamTaskPath(teamName, otherId)
    const other = pendingWrites.get(otherPath) ?? readTask(otherId)
    if (!other) {
      continue
    }

    pendingWrites.set(otherPath, {
      ...other,
      blockedBy: other.blockedBy.filter((id) => id !== taskId),
      blocks: other.blocks.filter((id) => id !== taskId),
    })
  }
}
