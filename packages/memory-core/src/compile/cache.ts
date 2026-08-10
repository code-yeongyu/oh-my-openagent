import { createHash } from "node:crypto"
import type { GitMemoryRepo } from "../git"
import {
  compileMemoryBlockAtRevision,
  type CompileMemoryBlockOptions,
} from "./compile"

export const MEMORY_TEMPLATE_STRUCTURE_VERSION = "senpi-memory-v1"

export function hashMemoryTemplate(template: string): string {
  return createHash("sha256")
    .update(MEMORY_TEMPLATE_STRUCTURE_VERSION)
    .update("\0")
    .update(template)
    .digest("hex")
}

export class MemoryBlockCache {
  private readonly entries = new Map<string, Promise<string>>()

  get size(): number {
    return this.entries.size
  }

  async compile(
    repo: GitMemoryRepo,
    template: string,
    options: CompileMemoryBlockOptions,
  ): Promise<string> {
    const revision = await repo.head()
    const key = `${hashMemoryTemplate(template)}:${revision ?? "no-head"}`
    const existing = this.entries.get(key)
    if (existing) return existing

    const pending = compileMemoryBlockAtRevision(repo, revision, options)
    this.entries.set(key, pending)
    try {
      return await pending
    } catch (error) {
      this.entries.delete(key)
      throw error
    }
  }

  clear(): void {
    this.entries.clear()
  }
}
