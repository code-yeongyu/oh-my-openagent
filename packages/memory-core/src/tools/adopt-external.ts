import { NoEffectiveChangesError, type GitCommitAuthor, type GitMemoryRepo } from "../git"
import type { MemoryWriteLock } from "./commit-write"
import { MemoryToolError } from "./tool-errors"

export interface AdoptExternalOptions {
  readonly repo: GitMemoryRepo
  readonly lock: MemoryWriteLock
  readonly author: GitCommitAuthor
  readonly sessionId?: string
}

export type AdoptExternalResult =
  { readonly status: "clean" } | { readonly status: "adopted"; readonly sha: string; readonly paths: readonly string[] }

// Porcelain v1 "XY path" or "XY old -> new": every path the change touches, deletions and both sides of a rename included.
function dirtyPaths(porcelain: string): string[] {
  const paths = new Set<string>()
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.length < 4) continue
    for (const part of line.slice(3).split(" -> ")) paths.add(part.replace(/^"|"$/g, ""))
  }
  return [...paths].sort()
}

/**
 * Commits edits another writer left in the memory repository (a process that appended outside the memory tool), so
 * memory writes and reflection can go on (#15411). It runs under the memory-write lock and through the same commit path
 * as a tool write, so the secret and frontmatter screens apply; a refused adoption is unstaged and leaves every file as
 * it found it, because these bytes belong to someone else.
 */
export async function adoptExternalEdits(options: AdoptExternalOptions): Promise<AdoptExternalResult> {
  const { repo, author } = options
  return options.lock("memory-write", async () => {
    const paths = dirtyPaths(await repo.status())
    if (paths.length === 0) return { status: "clean" }
    const message = [
      "chore(memory): adopt external edit",
      "",
      "Omo-Writer: external",
      `Omo-External-Paths: ${paths.join(", ")}`,
      ...(options.sessionId === undefined ? [] : [`Omo-Adopted-By: ${options.sessionId}`]),
    ].join("\n")
    try {
      const result = await repo.commitWrite(paths, message, author)
      return { status: "adopted", sha: result.sha, paths }
    } catch (error) {
      if (error instanceof NoEffectiveChangesError) return { status: "clean" }
      const atHead = new Set(await repo.lsTree("HEAD"))
      await repo.unstage(
        paths.filter((path) => atHead.has(path)),
        paths.filter((path) => !atHead.has(path)),
      )
      const reason = error instanceof Error ? error.message : String(error)
      throw new MemoryToolError(`adopting the external edit was refused; the files are left as they are: ${reason}`, {
        cause: error,
      })
    }
  })
}
