import type { MemoryBlockCache } from "@oh-my-opencode/memory-core"

export type MemoryCompileCache = Pick<MemoryBlockCache, "compile" | "clear" | "size">

/** Keep registration synchronous; construct the core cache only on the first bound prompt. */
export function createLazyMemoryCompileCache(): MemoryCompileCache {
  let runtime: Promise<typeof import("#omo-memory-compile-runtime")> | undefined
  let pending: Promise<MemoryCompileCache> | undefined
  let current: MemoryCompileCache | undefined

  function load(): Promise<MemoryCompileCache> {
    if (pending !== undefined) return pending
    runtime ??= import("#omo-memory-compile-runtime").catch((error: unknown) => {
      runtime = undefined
      throw error
    })
    const next = runtime.then(({ createMemoryCompileCache }) => createMemoryCompileCache())
    pending = next
    void next.then((cache) => {
      if (pending === next) current = cache
    }, () => {
      if (pending === next) pending = undefined
    })
    return next
  }

  return {
    get size() { return current?.size ?? 0 },
    async compile(...args) { return (await load()).compile(...args) },
    clear() {
      current?.clear()
      current = undefined
      // Calls already awaiting the old cache may finish, but cannot refill the new generation.
      pending = undefined
    },
  }
}
