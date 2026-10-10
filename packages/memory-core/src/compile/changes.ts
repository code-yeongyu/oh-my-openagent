import { GitCommandError, type GitMemoryRepo } from "../git"

export const MEMORY_SESSION_TRAILER = "Omo-Session"

/**
 * Paths whose change would alter a compiled block, grouped by what happened to them. `system/*.md`
 * bodies are projected, so an edit counts; every other non-skill path is projected by name only, so
 * only its arrival or removal counts.
 */
export interface ProjectedChanges {
  readonly added: readonly string[]
  readonly updated: readonly string[]
  readonly removed: readonly string[]
}

export interface ProjectedChangesOptions {
  readonly excludeSessionId?: string
}

const NO_CHANGES: ProjectedChanges = { added: [], updated: [], removed: [] }

export function isEmptyProjectedChanges(changes: ProjectedChanges): boolean {
  return changes.added.length === 0 && changes.updated.length === 0 && changes.removed.length === 0
}

/** `base === null`: the repo had no commit when the caller last looked, so every commit up to `head` counts. */
export async function projectedChangesBetween(
  repo: GitMemoryRepo,
  base: string | null,
  head: string | null,
  options: ProjectedChangesOptions = {},
): Promise<ProjectedChanges> {
  if (head === null || base === head) return NO_CHANGES
  const commits = await repo.log({ range: base === null ? head : `${base}..${head}`, includePaths: true })
  const touched = new Set<string>()
  for (const commit of commits) {
    if (options.excludeSessionId !== undefined && commit.trailers[MEMORY_SESSION_TRAILER] === options.excludeSessionId) continue
    for (const path of commit.paths ?? []) if (isProjectedPath(path)) touched.add(path)
  }
  if (touched.size === 0) return NO_CHANGES

  const [before, after] = await Promise.all([
    base === null ? Promise.resolve([]) : repo.lsTree(base),
    repo.lsTree(head),
  ])
  const beforeSet = new Set(before)
  const afterSet = new Set(after)
  const added: string[] = []
  const updated: string[] = []
  const removed: string[] = []
  for (const path of [...touched].sort((a, b) => a.localeCompare(b))) {
    const existedBefore = beforeSet.has(path)
    const existsAfter = afterSet.has(path)
    if (!existedBefore && existsAfter) added.push(path)
    else if (existedBefore && !existsAfter) removed.push(path)
    else if (existedBefore && existsAfter && isSystemBodyPath(path)) updated.push(path)
  }
  return { added, updated, removed }
}

/** Whether git still resolves `revision` to a commit; a history rewrite can take a pinned one away. */
export async function revisionExists(repo: GitMemoryRepo, revision: string): Promise<boolean> {
  try {
    await repo.log({ range: revision, limit: 1 })
    return true
  } catch (error) {
    if (error instanceof GitCommandError) return false
    throw error
  }
}

function isProjectedPath(path: string): boolean {
  if (path.startsWith("skills/")) return false
  return !path.startsWith("system/") || isSystemBodyPath(path)
}

function isSystemBodyPath(path: string): boolean {
  return path.startsWith("system/") && path.endsWith(".md")
}
