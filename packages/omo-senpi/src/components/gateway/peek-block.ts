import { GATEWAY_RULES_MIGRATIONS } from "./store-extension/migrations"

/** Read the committed block without opening the store worker or registering migrations. */
export async function peekGatewayRulesBlock(path: string, sessionId: string): Promise<string | undefined> {
  const { DatabaseSync } = await import("node:sqlite")
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    // Use exec callbacks rather than prepared statements: Bun otherwise retains the file after close.
    let hasTable = false
    db.function("preview_table", () => { hasTable = true; return null })
    db.exec("SELECT preview_table() FROM sqlite_schema WHERE type = 'table' AND name = 'gateway_rules_blocks'")
    if (!hasTable) return undefined
    let current = false
    db.function("preview_version", (version) => { current = version === GATEWAY_RULES_MIGRATIONS.length; return null })
    db.exec("SELECT preview_version(version) FROM extension_schema WHERE name = 'gateway_rules'")
    if (!current) return undefined
    let block: string | undefined
    db.function("preview_session", () => sessionId)
    db.function("preview_block", (value) => {
      if (typeof value === "string") block = value
      return null
    })
    db.exec("SELECT preview_block(block) FROM gateway_rules_blocks WHERE session_durable_id = preview_session()")
    return block
  } finally {
    db.close()
  }
}
