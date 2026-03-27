import { existsSync, cpSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { BOULDER_DIR } from "./constants"
import { log } from "../../shared/logger"

export function syncSisyphusStateFromWorktree(worktreePath: string, mainRepoPath: string): boolean {
  const srcDir = join(worktreePath, BOULDER_DIR)
  const destDir = join(mainRepoPath, BOULDER_DIR)

  if (!existsSync(srcDir)) {
    log("[worktree-sync] No .sisyphus directory in worktree, nothing to sync", { worktreePath })
    return true
  }

  try {
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true })
    }

    cpSync(srcDir, destDir, { recursive: true, force: true })
    log("[worktree-sync] Synced .sisyphus state from worktree to main repo", {
      worktreePath,
      mainRepoPath,
    })
    return true
  } catch (err) {
    log("[worktree-sync] Failed to sync .sisyphus state", {
      worktreePath,
      mainRepoPath,
      error: String(err),
    })
    return false
  }
}
