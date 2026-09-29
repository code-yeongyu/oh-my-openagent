import { existsSync } from "node:fs"
import { join } from "node:path"

import { getDataDir } from "../shared/data-path"

type BunDatabase = import("bun:sqlite").Database

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function openReadonly(file: string): Promise<BunDatabase | undefined> {
  if (typeof globalThis.Bun === "undefined" || !existsSync(file)) return undefined
  try {
    const dynamicImport = new Function("return import('bun:sqlite')") as () => Promise<typeof import("bun:sqlite")>
    const sqlite = await dynamicImport()
    return new sqlite.Database(file, { readonly: true })
  } catch (error) {
    if (error instanceof Error) return undefined
    return undefined
  }
}

export function openCodeDatabasePath(): string {
  return join(getDataDir(), "opencode", "opencode.db")
}

export async function sessionsFromDatabase(file = openCodeDatabasePath()): Promise<Array<Record<string, unknown>>> {
  const db = await openReadonly(file)
  if (!db) return []
  try {
    const rows = db.prepare(
      "SELECT id, title, directory, parent_id AS parentID, time_created AS created, time_updated AS updated FROM session_v2",
    ).all()
    if (!Array.isArray(rows)) return []
    return rows.filter(isRecord)
  } finally {
    db.close()
  }
}
