/**
 * Statement-free SQLite access for the store worker. Bun 1.4's `node:sqlite` keeps the database
 * file open after `close()` whenever a `StatementSync` was ever created (oven-sh/bun#40001), so
 * nothing here calls `prepare()`: parameters reach SQL through a user function (`gw_p(n)`), rows
 * come back through a varargs sink function, and `exec()` is the only entry point. `?` in SQL text
 * is tokenized so only anonymous placeholders become `gw_p(n)`; quotes and comments stay intact.
 *
 * Row order is never taken from a subquery or from the order the sink is called in: `all()` with
 * `orderBy` puts the ORDER BY on the outer select and passes `row_number() OVER (ORDER BY ...)` as
 * the sink's first argument, and rows are placed by that number.
 */

import { sqlTokens } from "./sql-tokens"

export type SqlAuthorizer = (action: number, arg1: string | null, arg2: string | null, database: string | null, source: string | null) => number

export type SqliteConnection = {
  exec(sql: string): void
  setAuthorizer(authorizer: SqlAuthorizer | null): void
  function(name: string, options: { readonly varargs?: boolean; readonly deterministic?: boolean }, fn: (...args: never[]) => unknown): void
  close(): void
}

export type SqlValue = string | number | null

export type SqlRow = Readonly<Record<string, unknown>>

export class Sql {
  private params: readonly SqlValue[] = []
  private sinkRows: unknown[][] = []
  private authorizer: SqlAuthorizer | null = null
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

  authorized<T>(authorizer: SqlAuthorizer | null, body: () => T): T {
    const previous = this.authorizer
    this.authorizer = authorizer
    this.db.setAuthorizer(authorizer)
    try {
      return body()
    } finally {
      this.authorizer = previous
      this.db.setAuthorizer(previous)
    }
  }

  /**
   * The output column names of a SELECT, as `sqlite3_column_name` would report them, read without
   * `prepare()`: a temp view's `table_info` (duplicate names come back as `name:1`). The view is only
   * compiled, never run, and it runs with no authorizer, so authorize the statement before calling this.
   */
  resultColumns(sql: string): string[] {
    return this.authorized(null, () => {
      this.db.exec(`CREATE TEMP VIEW gw_result_columns AS ${bind(sql)}\n`)
      try {
        return this.all(["name"], "SELECT cid, name FROM pragma_table_info('gw_result_columns', 'temp')", [], "cid").map((row) => String(row.name))
      } finally {
        this.db.exec("DROP VIEW temp.gw_result_columns")
      }
    })
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

  all(columns: readonly string[], sql: string, params: readonly SqlValue[] = [], orderBy?: string): SqlRow[] {
    this.params = params
    this.sinkRows = []
    try {
      const ordinal = orderBy === undefined ? "0" : `row_number() OVER (ORDER BY ${orderBy})`
      this.db.exec(`SELECT gw_sink(${ordinal}, ${columns.join(", ")}) FROM (${bind(sql)}\n)${orderBy === undefined ? "" : ` ORDER BY ${orderBy}`}`)
      const rows = orderBy === undefined ? this.sinkRows : this.sinkRows.toSorted((left, right) => Number(left[0]) - Number(right[0]))
      return rows.map((values) => Object.fromEntries(columns.map((column, index) => [column, values[index + 1] ?? null])))
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
  let bound = ""
  for (const token of sqlTokens(sql)) bound += token.kind === "parameter" ? `gw_p(${index++})` : token.text
  return bound
}

export function isBusyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const record = error as { readonly errcode?: unknown; readonly message?: unknown }
  return record.errcode === 5 || record.errcode === 6 || (typeof record.message === "string" && /database is (locked|busy)/i.test(record.message))
}
