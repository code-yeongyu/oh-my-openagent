import { existsSync } from "node:fs"
import { join } from "node:path"
import { getDataDir } from "./data-path"
import { isOpenCodeVersionAtLeast, OPENCODE_SQLITE_VERSION } from "./opencode-version"

const NOT_CACHED = Symbol("NOT_CACHED")
let cachedResult: boolean | typeof NOT_CACHED = NOT_CACHED

export function isSqliteBackend(): boolean {
  if (cachedResult !== NOT_CACHED) {
    return cachedResult
  }
  
  const versionOk = isOpenCodeVersionAtLeast(OPENCODE_SQLITE_VERSION)
  const dbPath = join(getDataDir(), "opencode", "opencode.db")
  const dbExists = existsSync(dbPath)
  
  cachedResult = versionOk && dbExists
  return cachedResult
}

export function resetSqliteBackendCache(): void {
  cachedResult = NOT_CACHED
}