import { Database } from "bun:sqlite"
import type { Env, RequestContext } from "../src/env"

export interface StoredObject {
  readonly body: Uint8Array
}

export class FakeBucket {
  readonly objects = new Map<string, StoredObject>()
  failWith: Error | null = null
  readonly reads: string[] = []

  put(key: string, body: string | Uint8Array): void {
    this.objects.set(key, { body: typeof body === "string" ? new TextEncoder().encode(body) : body })
  }

  private guard(key: string): StoredObject | undefined {
    this.reads.push(key)
    if (this.failWith !== null) throw this.failWith
    return this.objects.get(key)
  }

  async head(key: string): Promise<object | null> {
    return this.guard(key) === undefined ? null : { key }
  }

  async get(key: string): Promise<object | null> {
    const stored = this.guard(key)
    if (stored === undefined) return null
    const bytes = stored.body
    return {
      key,
      size: bytes.byteLength,
      httpEtag: `"${key}"`,
      body: new Response(bytes).body,
      text: async () => new TextDecoder().decode(bytes),
      writeHttpMetadata: (_headers: Headers) => undefined,
    }
  }
}

export class FakeCache {
  readonly entries = new Map<string, Response>()
  async match(request: Request): Promise<Response | undefined> {
    return this.entries.get(request.url)?.clone()
  }
  async put(request: Request, response: Response): Promise<void> {
    this.entries.set(request.url, new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers }))
  }
}

export interface DataPoint {
  readonly blobs: readonly string[]
}

export function sqliteD1(migration: string): { readonly db: D1Database; readonly sqlite: Database } {
  const sqlite = new Database(":memory:")
  if (migration.trim() !== "") sqlite.exec(migration)
  const statement = (sql: string, params: readonly unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    all: async () => ({ results: sqlite.query(sql).all(...(params as never[])) }),
    run: async () => {
      sqlite.query(sql).run(...(params as never[]))
      return { results: [] }
    },
    sql,
  })
  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: ReturnType<typeof statement>[]) =>
      Promise.all(statements.map((s) => (/^\s*(INSERT|UPDATE|DELETE)/i.test(s.sql) ? s.run() : s.all()))),
  }
  return { db: db as unknown as D1Database, sqlite }
}

export function harness(db: D1Database = sqliteD1("").db) {
  const bucket = new FakeBucket()
  const cache = new FakeCache()
  const points: DataPoint[] = []
  const pending: Promise<unknown>[] = []
  const env = {
    RELEASES: bucket as unknown as R2Bucket,
    DB: db,
    DOWNLOADS: { writeDataPoint: (point: DataPoint) => points.push(point) } as unknown as AnalyticsEngineDataset,
    ACCOUNT_ID: "account",
    ANALYTICS_DATASET: "omo_downloads",
    ANALYTICS_TOKEN: "token",
  } satisfies Env
  const ctx: RequestContext = { env, cache: cache as unknown as Cache, waitUntil: (p) => void pending.push(p) }
  return { bucket, cache, points, ctx, settle: () => Promise.all(pending) }
}
