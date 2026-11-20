import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"

import { gatewayDatabasePath, gatewayRootDirectory } from "../paths"
import { GATEWAY_MIGRATIONS } from "../schema"

/**
 * The old-binary fixture: the agent dir's gateway store as a newer omo build left it, `ahead` schema versions past
 * the ones this build knows (by default N+1, the next schema a newer build adds). Returns both versions, so a test names them the way the refusal must.
 */
export function storeMigratedByNewerBuild(
  agentDir: string,
  ahead = 1,
): { readonly gateway: number; readonly binary: number } {
  const binary = GATEWAY_MIGRATIONS.length
  const gateway = binary + ahead
  mkdirSync(gatewayRootDirectory(agentDir), { recursive: true })
  const db = new Database(gatewayDatabasePath(agentDir))
  try {
    for (const step of GATEWAY_MIGRATIONS) for (const statement of step) db.exec(statement)
    db.exec(`PRAGMA user_version = ${gateway}`)
  } finally {
    db.close()
  }
  return { gateway, binary }
}
