import type { GitMemoryRepo, GitPathState } from "../git"
import { parsePorcelainPath } from "../git"
import type { FactsApplyRecovery } from "./mutation-plan"

export type FactsOwnedState = ReadonlyMap<string, GitPathState>

export async function captureOwnedFactsState(
  repo: GitMemoryRepo,
  recovery: FactsApplyRecovery,
): Promise<FactsOwnedState | undefined> {
  if (await repo.head() !== recovery.headBeforeApply) return undefined
  const allowed = new Set(recovery.paths.map((entry) => entry.path))
  const dirty = (await repo.status()).split(/\r?\n/).filter(Boolean)
  if (dirty.some((line) => {
    const path = parsePorcelainPath(line)
    return path === null || !allowed.has(path)
  })) return undefined
  const current = await repo.pathState.captureAll([...allowed])
  return recovery.paths.every((entry) => {
    const state = current.get(entry.path)
    return state !== undefined
      && ownedIdentity(state.index, entry.pre.index, entry.post.index)
      && ownedIdentity(state.worktree, entry.pre.worktree, entry.post.worktree)
  }) ? current : undefined
}

export function sameFactsOwnedState(left: FactsOwnedState, right: FactsOwnedState): boolean {
  if (left.size !== right.size) return false
  return [...left].every(([path, state]) => sameIdentity(state, right.get(path)))
}

export function sameIdentity(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function ownedIdentity<T>(actual: T, pre: T, post: T): boolean {
  return sameIdentity(actual, pre) || sameIdentity(actual, post)
}
