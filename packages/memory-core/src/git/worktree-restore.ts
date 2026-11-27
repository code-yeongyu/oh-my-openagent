import { dirname, join } from "node:path"

import { mkdir, rm, writeFile } from "../fs/resilient"

import { normalizePathspecs } from "./repo-arguments"
import type { GitMemoryRepo } from "./repo"

// Puts back exactly the given paths from HEAD without touching the index: a path committed at HEAD
// gets its HEAD content again, a path HEAD does not have is removed. Used when a write's `git add`
// failed on a lock it could not take, so the index still matches HEAD and only the working-tree
// files this write produced are out of place; any other uncommitted file is left alone.
export async function restoreWorktreeFromHead(repo: GitMemoryRepo, paths: readonly string[]): Promise<void> {
  const normalized = normalizePathspecs(paths)
  if (normalized.length === 0) return
  const atHead = new Set(await repo.lsTree("HEAD"))
  for (const path of normalized) {
    const target = join(repo.dir, path)
    if (atHead.has(path)) {
      const content = await repo.show("HEAD", path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content, "utf8")
    } else {
      await rm(target, { force: true })
    }
  }
}
