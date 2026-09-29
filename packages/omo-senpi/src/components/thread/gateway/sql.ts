/**
 * Statement-free SQLite access for the store worker. Bun 1.4's `node:sqlite` keeps the database
 * file open after `close()` whenever a `StatementSync` was ever created (oven-sh/bun#40001), so
 * nothing here calls `prepare()`: parameters reach SQL through a user function (`gw_p(n)`), rows
 * come back through a varargs sink function, and `exec()` is the only entry point. `?` in SQL text
 * is rewritten to `gw_p(n)` in order; SQL written here never carries a literal `?`.
 */

export type SqliteConnection = {
  exec(sql: string): void
  function(name: string, options: { readonly varargs?: boolean; readonly deterministic?: boolean }, fn: (...args: never[]) => unknown): void
  close(): void
}

export type SqlValue = string | number | null

export type SqlRow = Readonly<Record<string, unknown>>

export class Sql {
  private params: readonly SqlValue[] = []
  private sinkRows: unknown[][] = []
  private readonly db: SqliteConnection

  constructor(db: SqliteConnection) {
    this.db = db
    db.function("gw_p", { deterministic: false }, ((index: number) => this.params[index] ?? null) as never)
    db.function("gw_sink", { varargs: true, deterministic: false }, ((...values: unknown[]) => {
      this.sinkRows.push(values)
      return null
    }) as never)
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  run(sql: string, params: readonly SqlValue[] = []): number {
    this.params = params
    try {
      this.db.exec(bind(sql))
    } finally {
      this.params = []
    }
    return Number(this.all(["n"], "SELECT changes() AS n")[0]?.n ?? 0)
  }

  all(columns: readonly string[], sql: string, params: readonly SqlValue[] = []): SqlRow[] {
    this.params = params
    this.sinkRows = []
    try {
      this.db.exec(`SELECT gw_sink(${columns.join(", ")}) FROM (${bind(sql)})`)
      return this.sinkRows.map((values) => Object.fromEntries(columns.map((column, index) => [column, values[index] ?? null])))
    } finally {
      this.params = []
      this.sinkRows = []
    }
  }

  one(columns: readonly string[], sql: string, params: readonly SqlValue[] = []): SqlRow | undefined {
    return this.all(columns, sql, params)[0]
  }
}

function bind(sql: string): string {
  let index = 0
  return sql.replace(/\?/g, () => `gw_p(${index++})`)
}

export function isBusyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const record = error as { readonly errcode?: unknown; readonly message?: unknown }
  return record.errcode === 5 || record.errcode === 6 || (typeof record.message === "string" && /database is (locked|busy)/i.test(record.message))
}
