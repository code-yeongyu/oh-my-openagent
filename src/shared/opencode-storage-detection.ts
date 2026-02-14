import { existsSync } from "node:fs"
import { join } from "node:path"
import { getDataDir } from "./data-path"
import { isOpenCodeVersionAtLeast, OPENCODE_SQLITE_VERSION } from "./opencode-version"

let cachedResult: boolean | null = null

export function isSqliteBackend(): boolean {
  if (cachedResult !== null) {
    return cachedResult
  }
  
  const versionOk = isOpenCodeVersionAtLeast(OPENCODE_SQLITE_VERSION)
  const dbPath = join(getDataDir(), "opencode", "opencode.db")
  const dbExists = existsSync(dbPath)
  
  cachedResult = versionOk && dbExists
  return cachedResult
}

export function resetSqliteBackendCache(): void {
  cachedResult = null
}