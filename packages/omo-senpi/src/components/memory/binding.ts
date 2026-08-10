import { createHash } from "node:crypto"

export const MEMORY_BINDING_CUSTOM_TYPE = "senpi-memory.session-binding"

export interface MemorySessionBinding {
  readonly identity: string
  readonly repoPathHash: string
  readonly boundAt: number
}

export interface SessionEntryLike {
  readonly type?: unknown
  readonly customType?: unknown
  readonly data?: unknown
}

export function createMemoryBinding(input: {
  readonly identity: string
  readonly repoPath: string
  readonly boundAt: number
}): MemorySessionBinding {
  return {
    identity: input.identity,
    repoPathHash: createHash("sha256").update(input.repoPath, "utf8").digest("hex"),
    boundAt: input.boundAt,
  }
}

export function findLatestMemoryBinding(entries: readonly SessionEntryLike[]): MemorySessionBinding | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.type !== "custom" || entry.customType !== MEMORY_BINDING_CUSTOM_TYPE) continue
    if (isMemorySessionBinding(entry.data)) return entry.data
  }
  return undefined
}

function isMemorySessionBinding(value: unknown): value is MemorySessionBinding {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  return (
    typeof Reflect.get(value, "identity") === "string"
    && typeof Reflect.get(value, "repoPathHash") === "string"
    && typeof Reflect.get(value, "boundAt") === "number"
  )
}
