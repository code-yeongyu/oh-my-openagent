import type { MemoryExpiry } from "./compile"

/** A persisted block with the expiry slot it was compiled in and every instant its revision declares. */
export interface StoredBlock {
  readonly block: string
  readonly slot: string
  readonly expiries: readonly MemoryExpiry[]
}

export function encodeStoredBlock({ block, slot, expiries }: StoredBlock): string {
  return JSON.stringify({ block, slot, expiries: expiries.map(({ path, expiresAtMs }) => [path, expiresAtMs]) })
}

/** A stored block, or `undefined` when the entry is not readable as one (it is then recompiled and rewritten). */
export function decodeStoredBlock(text: string): StoredBlock | undefined {
  try {
    const { block, slot, expiries }: { block?: unknown; slot?: unknown; expiries?: unknown } = JSON.parse(text)
    if (typeof block !== "string" || typeof slot !== "string" || !Array.isArray(expiries)) return undefined
    const pairs: unknown[] = expiries
    const parsed = pairs.flatMap((pair) => {
      const [path, expiresAtMs]: unknown[] = Array.isArray(pair) ? pair : []
      return typeof path === "string" && typeof expiresAtMs === "number" && Number.isFinite(expiresAtMs) ? [{ path, expiresAtMs }] : []
    })
    return parsed.length === pairs.length ? { block, slot, expiries: parsed } : undefined
  } catch {
    return undefined
  }
}
