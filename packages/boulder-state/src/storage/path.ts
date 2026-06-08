import { existsSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"

import { BOULDER_DIR, BOULDER_FILE } from "../constants"
import type { BoulderState, BoulderWorkState } from "../types"

export function getBoulderFilePath(directory: string): string {
  return join(directory, BOULDER_DIR, BOULDER_FILE)
}

function resolveTrackedPath(baseDirectory: string, trackedPath: string): string {
  return isAbsolute(trackedPath) ? resolve(trackedPath) : resolve(baseDirectory, trackedPath)
}

export function resolveBoulderPlanPath(
  directory: string,
  state: Pick<BoulderState, "active_plan" | "worktree_path">,
): string {
  const absolutePlanPath = resolveTrackedPath(directory, state.active_plan)
  const worktreePath = state.worktree_path?.trim()
  if (!worktreePath) {
    return absolutePlanPath
  }

  const absoluteDirectory = resolve(directory)
  const relativePlanPath = relative(absoluteDirectory, absolutePlanPath)
  if (relativePlanPath.length === 0 || relativePlanPath.startsWith("..") || isAbsolute(relativePlanPath)) {
    return absolutePlanPath
  }

  const absoluteWorktreePath = resolveTrackedPath(directory, worktreePath)
  const worktreePlanPath = resolve(absoluteWorktreePath, relativePlanPath)
  return existsSync(worktreePlanPath) ? worktreePlanPath : absolutePlanPath
}

export function resolveBoulderPlanPathForWork(
  directory: string,
  work: Pick<BoulderWorkState, "active_plan" | "worktree_path">,
): string {
  return resolveBoulderPlanPath(directory, work)
}
