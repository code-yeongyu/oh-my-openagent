// The exclusive gate over a repository's persisted recall terms, for work that replaces the repository
// (a backup restore). While a repository is excluded no term-store save of this process starts or lands
// in it, and saves already writing finish before the work runs; saves requested meanwhile are dropped,
// because their terms describe the tree being replaced and the next build saves again.

import { resolve } from "node:path"

// One state per process, not per module copy: the restore that takes the gate and the store that honors it
// load in different bundles, each with its own copy of this module.
interface GateState {
  readonly excluded: Map<string, number>
  readonly writing: Map<string, Set<Promise<void>>>
}
const GATE_KEY = Symbol.for("omo.memory-core.recall-term-save-gate")
const holder = globalThis as typeof globalThis & { [GATE_KEY]?: GateState }
const state: GateState = (holder[GATE_KEY] ??= { excluded: new Map(), writing: new Map() })
const { excluded, writing } = state

export function isRecallTermSaveExcluded(dir: string): boolean {
  return excluded.has(resolve(dir))
}

export function trackRecallTermSave(dir: string, save: Promise<void>): void {
  const key = resolve(dir)
  const saves = writing.get(key) ?? new Set<Promise<void>>()
  writing.set(key, saves)
  saves.add(save)
  void save.finally(() => {
    saves.delete(save)
    if (saves.size === 0 && writing.get(key) === saves) writing.delete(key)
  })
}

/** Runs `work` with every term-store save of this process kept out of `dir`. */
export async function withRecallTermSavesExcluded<T>(dir: string, work: () => Promise<T>): Promise<T> {
  const key = resolve(dir)
  excluded.set(key, (excluded.get(key) ?? 0) + 1)
  try {
    await Promise.all([...(writing.get(key) ?? [])])
    return await work()
  } finally {
    const depth = (excluded.get(key) ?? 1) - 1
    if (depth === 0) excluded.delete(key)
    else excluded.set(key, depth)
  }
}
