import { existsSync } from "node:fs"
import { join } from "node:path"
import { getDataDir } from "./data-path"
import { isOpenCodeVersionAtLeast, OPENCODE_SQLITE_VERSION } from "./opencode-version"

const NOT_CACHED = Symbol("NOT_CACHED")
const FALSE_PENDING_RETRY = Symbol("FALSE_PENDING_RETRY")
let cachedResult: true | false | typeof NOT_CACHED | typeof FALSE_PENDING_RETRY = NOT_CACHED

export function isSqliteBackend(): boolean {
  if (cachedResult === true) return true
  if (cachedResult === false) return false

  const check = (): boolean => {
    const versionOk = isOpenCodeVersionAtLeast(OPENCODE_SQLITE_VERSION)
    const dbPath = join(getDataDir(), "opencode", "opencode.db")
    return versionOk && existsSync(dbPath)
  }

  if (cachedResult === FALSE_PENDING_RETRY) {
    const result = check()
    cachedResult = result
    return result
  }

  const result = check()
  if (result) { cachedResult = true }
  else { cachedResult = FALSE_PENDING_RETRY }
  return result
}

export function resetSqliteBackendCache(): void {
  cachedResult = NOT_CACHED
}