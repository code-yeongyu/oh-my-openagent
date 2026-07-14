/**
 * Cross-runtime SQLite shim.
 *
 * Runs under Bun (bun:sqlite) or Node/Electron (node:sqlite) via
 * runtime detection and dynamic imports so static analyzers see
 * neither backend at parse time.
 *
 * Exports a `Database` interface that both backends satisfy, plus
 * a factory `createDb(path, options?)` that opens/creates a SQLite
 * file with WAL journal, foreign_keys=ON, and busy_timeout=5000.
 */

import type { Database as BunDatabase } from "bun:sqlite"

// ── Minimal Statement interface (subset of bun:sqlite) ────────

export interface Statement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

// ── Minimal Database interface (both backends satisfy) ────────

export interface Database {
  prepare(sql: string): Statement
  exec(sql: string): void
  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T
  close(): void
  readonly isTransaction: boolean
  readonly isOpen: boolean
}

export interface CreateDbOptions {
  readonly?: boolean
  cacheSizeMb?: number
  mmapSizeMb?: number
}

// ── Runtime detection ────────────────────────────────────────

const isBun =
  typeof process !== "undefined" &&
  typeof process.versions?.bun === "string"

// ── Dynamic import helpers (bundler-evading) ─────────────────

const bunSpec = "bun:" + "sqlite"
const nodeSpec = "node:" + "sqlite"

// ── Construct the platform Database constructor ───────────────

let DatabaseCtor: new (
  path: string,
  options?: Record<string, unknown>,
) => Database

if (isBun) {
  // Bun path — bun:sqlite works as-is. We wrap it to normalise the
  // interface and add the transaction helper for symmetry.
  const bunModule: { Database: new (...args: unknown[]) => BunDatabase } = await import(
    /* @vite-ignore */
    bunSpec
  )
  const BunDatabaseCtor = bunModule.Database

  // biome-ignore lint/suspicious/noExplicitAny: cross-runtime adapter
  DatabaseCtor = class WrappedBunDatabase implements Database {
    // biome-ignore lint/suspicious/noExplicitAny: adapter pattern
    private db: any

    constructor(path: string, options?: Record<string, unknown>) {
      // bun:sqlite expects `readonly` (lowercase)
      if (options && Object.keys(options).length > 0) {
        this.db = new BunDatabaseCtor(path, options)
      } else {
        this.db = new BunDatabaseCtor(path)
      }
      this.db.exec("PRAGMA journal_mode=WAL")
      this.db.exec("PRAGMA foreign_keys=ON")
      this.db.exec("PRAGMA busy_timeout=5000")
    }

    prepare(sql: string): Statement {
      // biome-ignore lint/suspicious/noExplicitAny: adapter pattern
      const stmt: any = this.db.prepare(sql)
      return stmt as Statement
    }

    exec(sql: string): void {
      this.db.exec(sql)
    }

    // biome-ignore lint/suspicious/noExplicitAny: cross-runtime adapter
    transaction<T extends (...args: any[]) => any>(fn: T): T {
      return this.db.transaction(fn) as T
    }

    close(): void {
      this.db.close()
    }

    get isTransaction(): boolean {
      return Boolean(this.db.inTransaction)
    }

    get isOpen(): boolean {
      return Boolean(this.db?.isOpen ?? true)
    }
  }
} else {
  // Node/Electron path — node:sqlite may lack `.transaction()` and
  // uses `readOnly` instead of `readonly`, so we build a wrapper.
  const nodeModule: {
    DatabaseSync: new (...args: unknown[]) => {
      prepare(sql: string): unknown
      exec(sql: string): void
      close(): void
      readonly isTransaction: boolean
    }
  } = await import(/* @vite-ignore */ nodeSpec)

  const NodeDatabaseSyncCtor = nodeModule.DatabaseSync
  const SAVEPOINT = "mtx_tx_sp"

  // biome-ignore lint/suspicious/noExplicitAny: cross-runtime adapter
  DatabaseCtor = class WrappedNodeDatabase implements Database {
    // biome-ignore lint/suspicious/noExplicitAny: adapter pattern
    private db: any
    private _isTransaction = false

    constructor(path: string, options?: Record<string, unknown>) {
      const translated: Record<string, unknown> = { ...options }
      if (options && "readonly" in options) {
        translated.readOnly = (
          options as { readonly?: boolean }
        ).readonly
        delete translated.readonly
      }
      this.db = new NodeDatabaseSyncCtor(path, translated)
      this.db.exec("PRAGMA journal_mode=WAL")
      this.db.exec("PRAGMA foreign_keys=ON")
      this.db.exec("PRAGMA busy_timeout=5000")
    }

    prepare(sql: string): Statement {
      const stmt = this.db.prepare(sql)
      // Normalise lone-array binds: node:sqlite treats a single array
      // arg as NAMED params { "0": ..., "1": ... } and throws. Spread
      // the array so it binds positionally like bun/better-sqlite3.
      for (const method of ["run", "get", "all"] as const) {
        const original = stmt[method].bind(stmt)
        stmt[method] = (...args: unknown[]): unknown =>
          args.length === 1 && Array.isArray(args[0])
            ? original(...args[0])
            : original(...args)
      }
      return stmt as Statement
    }

    exec(sql: string): void {
      this.db.exec(sql)
    }

    // biome-ignore lint/suspicious/noExplicitAny: cross-runtime adapter
    transaction<T extends (...args: any[]) => any>(fn: T): T {
      // biome-ignore lint/suspicious/noExplicitAny: adapter pattern
      const self = this as any
      const wrapped = function (this: unknown, ...args: unknown[]): unknown {
        const nested = self._isTransaction === true
        self.exec(nested ? `SAVEPOINT ${SAVEPOINT}` : "BEGIN")
        try {
          const result = fn.apply(this, args)
          self.exec(nested ? `RELEASE ${SAVEPOINT}` : "COMMIT")
          return result
        } catch (error) {
          if (nested) {
            self.exec(`ROLLBACK TO ${SAVEPOINT}`)
            self.exec(`RELEASE ${SAVEPOINT}`)
          } else {
            self.exec("ROLLBACK")
          }
          throw error
        }
      }
      return wrapped as unknown as T
    }

    close(): void {
      this.db.close()
    }

    get isTransaction(): boolean {
      return this._isTransaction
    }

    get isOpen(): boolean {
      return true
    }
  }
}

// ── Factory ──────────────────────────────────────────────────

export function createDb(
  path: string,
  options: CreateDbOptions = {},
): Database {
  const dbOptions: Record<string, unknown> = {}
  if (options.readonly !== undefined) {
    dbOptions.readonly = options.readonly
  }
  const db = new DatabaseCtor(path, dbOptions)

  // Apply tuning pragmas if custom sizes were given
  if (options.cacheSizeMb !== undefined) {
    db.exec(
      `PRAGMA cache_size=-${Math.round(options.cacheSizeMb * 1024)}`,
    )
  }
  if (options.mmapSizeMb !== undefined) {
    db.exec(
      `PRAGMA mmap_size=${Math.round(options.mmapSizeMb * 1024 * 1024)}`,
    )
  }
  if (options.cacheSizeMb === undefined) {
    db.exec("PRAGMA cache_size=-65536") // 64 MiB default
  }

  return db
}

/**
 * Close a database connection quietly — swallow errors so callers
 * in `finally` blocks or teardown paths don't need try/catch.
 */
export function closeQuietly(db: Database | null | undefined): void {
  if (!db) return
  try {
    db.close()
  } catch {
    // intentional: caller wants quiet close
  }
}
