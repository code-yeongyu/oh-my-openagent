import { Database } from "bun:sqlite"

const dbPath = process.argv[2]
if (!dbPath) {
  console.error("usage: bun count-sessions.ts <db-path>")
  process.exit(1)
}
const db = new Database(dbPath, { readonly: true })
const row = db.query("SELECT count(*) AS n FROM session").get() as { n: number } | undefined
console.log(`session count: ${row?.n ?? 0}`)
db.close()
