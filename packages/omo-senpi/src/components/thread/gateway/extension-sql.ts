import type { Sql, SqlRow } from "./sql"

/**
 * SQLite's authorizer result and action codes, from sqlite3.h. They are fixed by SQLite's C API,
 * so they are spelled out here: only the store worker may load `node:sqlite`, and only lazily.
 */
const constants = {
  SQLITE_OK: 0,
  SQLITE_DENY: 1,
  SQLITE_CREATE_INDEX: 1,
  SQLITE_CREATE_TABLE: 2,
  SQLITE_CREATE_TRIGGER: 7,
  SQLITE_CREATE_VIEW: 8,
  SQLITE_DELETE: 9,
  SQLITE_DROP_INDEX: 10,
  SQLITE_DROP_TABLE: 11,
  SQLITE_INSERT: 18,
  SQLITE_READ: 20,
  SQLITE_SELECT: 21,
  SQLITE_UPDATE: 23,
  SQLITE_ALTER_TABLE: 26,
  SQLITE_REINDEX: 27,
  SQLITE_FUNCTION: 31,
  SQLITE_RECURSIVE: 33,
} as const

export class ExtensionSchemaViolation extends Error {
  readonly code = "extension_schema_violation"
}

type SchemaSnapshot = {
  readonly objects: readonly SqlRow[]
  readonly owners: ReadonlyMap<string, string | null>
}

const COLUMNS = ["type", "name", "tbl_name", "sql"] as const
export const sqliteName = (name: string): string => name.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
const keyOf = (row: SqlRow): string => `${String(row.type)}:${sqliteName(String(row.name))}`

export function extensionSchema(sql: Sql): SchemaSnapshot {
  return {
    objects: sql.all(COLUMNS, "SELECT type, name, tbl_name, sql FROM sqlite_schema", [], "type, name"),
    owners: new Map(sql.all(["type", "name", "owner"], "SELECT type, name, owner FROM extension_objects")
      .map((row) => [keyOf(row), row.owner === null ? null : String(row.owner)])),
  }
}

export function assertExtensionName(sql: Sql, name: string): void {
  const core = sql.all(["name"], "SELECT name FROM extension_objects WHERE owner IS NULL")
  if (["gateway", "thread", "sqlite"].includes(name) || core.some((row) => sqliteName(String(row.name)).startsWith(name))) {
    throw new ExtensionSchemaViolation(`Extension name ${name} collides with a core namespace.`)
  }
}

/** Validate actual schema effects, then persist ownership in the same transaction as those effects. */
export function checkExtensionSchema(sql: Sql, name: string, before: SchemaSnapshot, after: SchemaSnapshot): void {
  const old = new Map(before.objects.map((row) => [keyOf(row), row]))
  const next = new Map(after.objects.map((row) => [keyOf(row), row]))
  const changed = [...new Set([...old.keys(), ...next.keys()])].filter((key) => JSON.stringify(old.get(key)) !== JSON.stringify(next.get(key)))
  for (const key of changed) {
    const a = old.get(key)
    const b = next.get(key)
    if (a !== undefined && before.owners.get(key) !== name) {
      throw new ExtensionSchemaViolation(`Extension ${name} changed an object it does not own: ${String(a.name)}.`)
    }
    if (b === undefined) continue
    if (b.type === "trigger" || b.type === "view") {
      throw new ExtensionSchemaViolation("Store extensions cannot create triggers or views.")
    }
    const objectName = sqliteName(String(b.name))
    const automaticIndex = b.type === "index" && b.sql === null && objectName.startsWith(`sqlite_autoindex_${sqliteName(String(b.tbl_name))}_`)
    if ((!automaticIndex && !objectName.startsWith(`${name}_`)) || (before.owners.has(key) && before.owners.get(key) !== name)) {
      throw new ExtensionSchemaViolation(`Extension ${name} created an object outside its namespace: ${String(b.name)}.`)
    }
    if (b.type === "index") {
      const tableKey = `table:${sqliteName(String(b.tbl_name))}`
      const tableAddedHere = !old.has(tableKey) && next.has(tableKey) && changed.includes(tableKey)
      if (before.owners.get(tableKey) !== name && after.owners.get(tableKey) !== name && !tableAddedHere) {
        throw new ExtensionSchemaViolation(`Extension ${name} indexed a table it does not own: ${String(b.tbl_name)}.`)
      }
    }
  }
  for (const key of changed) {
    const a = old.get(key)
    const b = next.get(key)
    if (a !== undefined) {
      sql.run("DELETE FROM extension_objects WHERE type = ? AND name = ? COLLATE NOCASE AND owner = ?", [String(a.type), String(a.name), name])
    }
    if (b !== undefined) {
      sql.run("INSERT INTO extension_objects (type, name, owner) VALUES (?, ?, ?) ON CONFLICT(type, name) DO UPDATE SET owner = excluded.owner", [String(b.type), sqliteName(String(b.name)), name])
    }
  }
}

/** Authorize resolved SQLite statements, including DELETE's truncate form, not just cursor accesses. */
export function extensionSql<T>(sql: Sql, name: string, body: () => T): T {
  const snapshot = extensionSchema(sql)
  const owners = new Map(snapshot.owners)
  const programs = new Set(snapshot.objects.filter((row) => row.type === "trigger" || row.type === "view").map((row) => sqliteName(String(row.name))))
  const owned = (type: string, object: string | null): boolean => object !== null && owners.get(`${type}:${object}`) === name
  const claim = (type: string, object: string | null, automaticIndex = false): boolean => {
    if (object === null || (!automaticIndex && !object.startsWith(`${name}_`)) || owners.has(`${type}:${object}`)) return false
    owners.set(`${type}:${object}`, name)
    return true
  }
  let ddl: "create" | "alter" | "drop" | undefined
  let catalogWritten = false
  let denied: string | undefined
  const allow = constants.SQLITE_OK
  const deny = (object: string | null): number => {
    denied = `Extension ${name} does not own ${object ?? "this SQLite operation"}.`
    return constants.SQLITE_DENY
  }
  try {
    return sql.authorized((action, rawA, rawB, rawDatabase, rawSource) => {
      const a = rawA === null ? null : sqliteName(rawA)
      const b = rawB === null ? null : sqliteName(rawB)
      const database = rawDatabase === null ? null : sqliteName(rawDatabase)
      const source = rawSource === null ? null : sqliteName(rawSource)
      // SQLite also labels CTE reads with their CTE name; those are not persisted programs.
      if (source !== null && programs.has(source)) return deny(source)
      switch (action) {
        case constants.SQLITE_CREATE_TABLE:
          ddl = "create"
          return database === "main" && claim("table", a) ? allow : deny(a)
        case constants.SQLITE_CREATE_INDEX:
          ddl = "create"
          return database === "main" && owned("table", b) && claim("index", a, a?.startsWith(`sqlite_autoindex_${b}_`) === true) ? allow : deny(a)
        case constants.SQLITE_DROP_TABLE:
          ddl = "drop"
          return database === "main" && owned("table", a) ? allow : deny(a)
        case constants.SQLITE_DROP_INDEX:
          ddl = "drop"
          return database === "main" && owned("index", a) && owned("table", b) ? allow : deny(a)
        case constants.SQLITE_ALTER_TABLE:
          ddl = "alter"
          return a === "main" && owned("table", b) ? allow : deny(b)
        case constants.SQLITE_REINDEX:
          return database === "main" && owned("index", a) ? allow : deny(a)
        case constants.SQLITE_READ:
        case constants.SQLITE_INSERT:
        case constants.SQLITE_UPDATE:
        case constants.SQLITE_DELETE:
          // sqlite_master writes precede CREATE/DROP callbacks. SQLite prohibits direct catalog
          // writes; PRAGMA/writable_schema is never allowed. DDL is isolated to one statement.
          if (a === "sqlite_master" || a === "sqlite_temp_master") {
            if (action === constants.SQLITE_UPDATE && b === "sql") catalogWritten = true
            if (action !== constants.SQLITE_READ) return allow
            return ddl === "alter" || ddl === "drop" || (ddl === "create" && catalogWritten && b === "rowid") ? allow : deny(a)
          }
          // ALTER's own SQLite program renames only the authorized table's sequence entry.
          // Direct reads/writes cannot reach this branch without that single ALTER statement.
          if (ddl === "alter" && a === "sqlite_sequence" && b === "name"
            && (action === constants.SQLITE_READ || action === constants.SQLITE_UPDATE)) return allow
          // SQLite's optimized rowid/count read has an empty column and no database label.
          return (database === "main" || (database === null && action === constants.SQLITE_READ && b === "")) && owned("table", a) ? allow : deny(a)
        case constants.SQLITE_SELECT:
        case constants.SQLITE_RECURSIVE:
          return allow
        case constants.SQLITE_FUNCTION:
          return b === "load_extension" ? deny(b) : allow
        case constants.SQLITE_CREATE_TRIGGER:
        case constants.SQLITE_CREATE_VIEW:
          return deny(a)
        // Includes DROP TRIGGER/VIEW, TEMP, ATTACH, transaction control and PRAGMA.
        default:
          return deny(a)
      }
    }, body)
  } catch (error) {
    if (denied !== undefined) throw new ExtensionSchemaViolation(denied)
    throw error
  }
}
