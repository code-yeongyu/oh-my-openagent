import { createHash } from "node:crypto"
import type { GitMemoryRepo } from "../git"
import {
  compileMemoryBlockAtRevision,
  type CompileMemoryBlockOptions,
} from "./compile"

export const MEMORY_TEMPLATE_STRUCTURE_VERSION = "senpi-memory-v2"

export function hashMemoryTemplate(template: string): string {
  return createHash("sha256")
    .update(MEMORY_TEMPLATE_STRUCTURE_VERSION)
    .update("\0")
    .update(template)
    .digest("hex")
}

interface MemoryBlockCacheEntry {
  readonly variant: string
  readonly pending: Promise<string>
}

export class MemoryBlockCache {
  private readonly entries = new Map<string, MemoryBlockCacheEntry>()

  get size(): number {
    return this.entries.size
  }

  /**
   * Compile at `revision`, or at HEAD when it is omitted. A caller that pins a session to one commit
   * passes that commit so later memory commits cannot change the bytes it injects.
   */
  async compile(
    repo: GitMemoryRepo,
    template: string,
    options: CompileMemoryBlockOptions,
    pinnedRevision?: string | null,
  ): Promise<string> {
    const revision = pinnedRevision === undefined ? await repo.head() : pinnedRevision
    const key = `${hashMemoryTemplate(template)}:${options.agentId}`
    const variant = revision ?? "no-head"
    const existing = this.entries.get(key)
    if (existing?.variant === variant) return existing.pending

    const pending = compileMemoryBlockAtRevision(repo, revision, options)
    const entry = { variant, pending }
    this.entries.set(key, entry)
    try {
      return await pending
    } catch (error) {
      if (this.entries.get(key) === entry) this.entries.delete(key)
      throw error
    }
  }

  clear(): void {
    this.entries.clear()
  }
}
