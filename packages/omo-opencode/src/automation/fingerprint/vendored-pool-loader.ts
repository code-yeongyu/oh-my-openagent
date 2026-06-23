import poolJson from "./vendored-pool.json"
import { validateVendoredPool, type VendoredPool, type PoolEntry } from "./pool-schema"

let cached: VendoredPool | null = null

export function loadVendoredPool(): VendoredPool {
  if (cached) return cached
  cached = validateVendoredPool(poolJson)
  return cached
}

export function getVendoredEntries(filter: Partial<Pick<PoolEntry, "browser" | "os" | "type">> = {}): PoolEntry[] {
  return loadVendoredPool().pool.filter((entry) =>
    (filter.browser === undefined || entry.browser === filter.browser)
    && (filter.os === undefined || entry.os === filter.os)
    && (filter.type === undefined || entry.type === filter.type),
  )
}
