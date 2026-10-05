import { MemoryBlockCache } from "@oh-my-opencode/memory-core"

export function createMemoryCompileCache(): MemoryBlockCache {
  return new MemoryBlockCache()
}
